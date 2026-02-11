'use strict';

import { EventEmitter } from 'events';
import { AjaxApiClient } from './ajax-api';

// Homey reference type - we use 'any' to avoid namespace issues
// The homey instance is passed from the app at runtime
type HomeyInstance = any;
import {
  AjaxHub,
  AjaxDevice,
  AjaxGroup,
  AjaxRoom,
  HubData,
  CoordinatorData,
  PollingConfig,
  AjaxApiError,
  AjaxAuthError,
} from './types';
import { parseArmingState } from './util';

const DEFAULT_ARMED_INTERVAL = 10;
const DEFAULT_DISARMED_INTERVAL = 30;
const MAX_CONSECUTIVE_ERRORS = 5;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60_000;
const STATE_PROTECTION_SSE_MS = 5_000;
const STATE_PROTECTION_SQS_MS = 15_000;

export class AjaxCoordinator extends EventEmitter {

  private api: AjaxApiClient;
  private homey: HomeyInstance;
  private log: (...args: any[]) => void;
  private error: (...args: any[]) => void;

  private pollingConfig: PollingConfig;
  private pollTimer: NodeJS.Timeout | null = null;
  private running: boolean = false;

  // Current data
  private data: CoordinatorData = {
    hubs: new Map(),
    lastUpdate: 0,
  };

  // Error tracking
  private consecutiveErrors: number = 0;

  // State protection: device IDs with timestamps that should not be overwritten by polling
  private stateProtection: Map<string, number> = new Map();

  constructor(
    api: AjaxApiClient,
    homey: HomeyInstance,
    pollingConfig: Partial<PollingConfig> = {},
    log: (...args: any[]) => void,
    error: (...args: any[]) => void,
  ) {
    super();
    this.api = api;
    this.homey = homey;
    this.log = log;
    this.error = error;
    this.pollingConfig = {
      armedIntervalSeconds: pollingConfig.armedIntervalSeconds || DEFAULT_ARMED_INTERVAL,
      disarmedIntervalSeconds: pollingConfig.disarmedIntervalSeconds || DEFAULT_DISARMED_INTERVAL,
      doorSensorFastPoll: pollingConfig.doorSensorFastPoll || false,
      doorSensorIntervalSeconds: pollingConfig.doorSensorIntervalSeconds || 5,
    };
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  /**
   * Start the polling loop.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.log('Coordinator started');
    this.poll(); // Initial fetch
  }

  /**
   * Stop the polling loop.
   */
  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      this.homey.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.log('Coordinator stopped');
  }

  /**
   * Force an immediate poll (e.g., after receiving a real-time event).
   */
  async refresh(): Promise<void> {
    if (this.pollTimer) {
      this.homey.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    await this.poll();
  }

  // ============================================================
  // Runtime Updates
  // ============================================================

  /**
   * Swap the API client (e.g., after re-login).
   * Preserves all event listeners and cached data.
   */
  updateApi(api: AjaxApiClient): void {
    this.api = api;
  }

  // ============================================================
  // Data Access
  // ============================================================

  getData(): CoordinatorData {
    return this.data;
  }

  getHubData(hubId: string): HubData | undefined {
    return this.data.hubs.get(hubId);
  }

  getHub(hubId: string): AjaxHub | undefined {
    return this.data.hubs.get(hubId)?.hub;
  }

  getDevice(hubId: string, deviceId: string): AjaxDevice | undefined {
    return this.data.hubs.get(hubId)?.devices.get(deviceId);
  }

  getGroup(hubId: string, groupId: string): AjaxGroup | undefined {
    return this.data.hubs.get(hubId)?.groups.get(groupId);
  }

  getAllHubIds(): string[] {
    return Array.from(this.data.hubs.keys());
  }

  getAllDevicesForHub(hubId: string): AjaxDevice[] {
    const hubData = this.data.hubs.get(hubId);
    return hubData ? Array.from(hubData.devices.values()) : [];
  }

  // ============================================================
  // State Protection (for real-time events)
  // ============================================================

  /**
   * Protect a device from being overwritten by the next poll cycle.
   */
  protectDeviceState(deviceId: string, source: 'sse' | 'sqs'): void {
    const duration = source === 'sse' ? STATE_PROTECTION_SSE_MS : STATE_PROTECTION_SQS_MS;
    this.stateProtection.set(deviceId, Date.now() + duration);
  }

  /**
   * Protect a hub from being overwritten.
   */
  protectHubState(hubId: string, source: 'sse' | 'sqs'): void {
    this.protectDeviceState(`hub_${hubId}`, source);
  }

  private isProtected(id: string): boolean {
    const expiry = this.stateProtection.get(id);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      this.stateProtection.delete(id);
      return false;
    }
    return true;
  }

  // ============================================================
  // Polling
  // ============================================================

  private getPollingInterval(): number {
    // Check if any hub is armed
    let anyArmed = false;
    for (const hubData of this.data.hubs.values()) {
      const { armed } = parseArmingState(hubData.hub.state);
      if (armed) {
        anyArmed = true;
        break;
      }
    }

    const seconds = anyArmed
      ? this.pollingConfig.armedIntervalSeconds
      : this.pollingConfig.disarmedIntervalSeconds;

    return seconds * 1000;
  }

  private scheduleNextPoll(): void {
    if (!this.running) return;
    const interval = this.getPollingInterval();
    this.pollTimer = this.homey.setTimeout(() => this.poll(), interval);
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      await this.fetchAllData();
      this.consecutiveErrors = 0;
    } catch (err) {
      this.consecutiveErrors++;

      if (err instanceof AjaxAuthError) {
        this.error('Authentication error during poll:', (err as Error).message);
        this.emit('authError', err);
        // Retry with max backoff - session may recover after re-login
        this.pollTimer = this.homey.setTimeout(() => this.poll(), BACKOFF_MAX_MS);
        return;
      }

      this.error(`Poll error (${this.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, (err as Error).message);

      if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        this.emit('unavailable', 'Too many consecutive errors');
      }

      // Exponential backoff
      const backoff = Math.min(
        BACKOFF_BASE_MS * Math.pow(2, this.consecutiveErrors - 1),
        BACKOFF_MAX_MS,
      );
      this.pollTimer = this.homey.setTimeout(() => this.poll(), backoff);
      return;
    }

    this.scheduleNextPoll();
  }

  private async fetchAllData(): Promise<void> {
    const hubs = await this.api.getHubs();

    for (let hub of hubs) {
      const hubId = hub.id;
      const existingHubData = this.data.hubs.get(hubId);

      // Fetch devices, groups, rooms in parallel.
      // In proxy mode, also fetch hub details (the list endpoint only has basic fields).
      const [hubDetail, devices, rooms, groups] = await Promise.all([
        this.api.isProxyMode() ? this.api.getHub(hubId).catch(() => null) : Promise.resolve(null),
        this.api.getDevices(hubId),
        this.api.getRooms(hubId),
        hub.groupsEnabled ? this.api.getGroups(hubId) : Promise.resolve([] as AjaxGroup[]),
      ]);

      // Merge detailed hub data over the list data (proxy mode)
      if (hubDetail) {
        hub = { ...hub, ...hubDetail, id: hubId, name: hub.name || hubDetail.name };
      }

      // Build maps
      const deviceMap = new Map<string, AjaxDevice>();
      for (const device of devices) {
        deviceMap.set(device.id, device);
      }

      const roomMap = new Map<string, AjaxRoom>();
      for (const room of rooms) {
        roomMap.set(room.id, room);
      }

      const groupMap = new Map<string, AjaxGroup>();
      for (const group of groups) {
        groupMap.set(group.id, group);
      }

      // Enrich device room names
      for (const device of deviceMap.values()) {
        if (device.roomId && roomMap.has(device.roomId)) {
          device.roomName = roomMap.get(device.roomId)!.name;
        }
      }

      // Check for hub state changes (skip if protected)
      if (!this.isProtected(`hub_${hubId}`) && existingHubData) {
        if (existingHubData.hub.state !== hub.state) {
          this.emit('hubStateChange', { hubId, hub });
        }
        if (existingHubData.hub.online !== hub.online) {
          this.emit('hubOnlineChange', { hubId, hub });
        }
      }

      // Check for device state changes (skip if protected)
      if (existingHubData) {
        for (const [deviceId, device] of deviceMap) {
          if (this.isProtected(deviceId)) continue;

          const existing = existingHubData.devices.get(deviceId);
          if (existing) {
            const changed = this.hasDeviceChanged(existing, device);
            if (changed) {
              this.emit('deviceStateChange', { hubId, deviceId, device });
            }
          } else {
            // New device
            this.emit('deviceAdded', { hubId, deviceId, device });
          }
        }
      }

      // Check for group state changes
      if (existingHubData) {
        for (const [groupId, group] of groupMap) {
          const existing = existingHubData.groups.get(groupId);
          if (existing && (existing.state !== group.state || existing.nightModeEnabled !== group.nightModeEnabled)) {
            this.emit('groupStateChange', { hubId, groupId, group });
          }
        }
      }

      // Update stored data
      this.data.hubs.set(hubId, {
        hub,
        devices: deviceMap,
        groups: groupMap,
        rooms: roomMap,
      });
    }

    // Remove hubs that are no longer returned by the API
    const currentHubIds = new Set(hubs.map(h => h.id));
    for (const hubId of this.data.hubs.keys()) {
      if (!currentHubIds.has(hubId)) {
        this.log(`Hub ${hubId} no longer present, removing from data`);
        this.data.hubs.delete(hubId);
      }
    }

    this.data.lastUpdate = Date.now();
    this.emit('dataUpdated', this.data);
  }

  /**
   * Compare two device states to detect changes.
   */
  private hasDeviceChanged(oldDevice: AjaxDevice, newDevice: AjaxDevice): boolean {
    if (oldDevice.online !== newDevice.online) return true;
    if (oldDevice.tampered !== newDevice.tampered) return true;
    if (oldDevice.batteryChargeLevelPercentage !== newDevice.batteryChargeLevelPercentage) return true;
    if (oldDevice.temperature !== newDevice.temperature) return true;
    if (oldDevice.signalLevel !== newDevice.signalLevel) return true;

    // Compare model (device-specific state)
    const oldModel = oldDevice.model || {};
    const newModel = newDevice.model || {};

    // Check key state fields that indicate meaningful changes
    const stateKeys = [
      'state', 'reedClosed', 'extraContactClosed', 'tamperState',
      'smokeAlarmDetected', 'temperatureAlarmDetected', 'coAlarmDetected',
      'highTemperatureDiffDetected', 'leakDetected', 'glassBreak',
      'switchState', 'motionDetected', 'valveState',
    ];

    for (const key of stateKeys) {
      if (oldModel[key] !== newModel[key]) return true;
    }

    return false;
  }

  // ============================================================
  // Direct State Updates (from SQS/SSE events)
  // ============================================================

  /**
   * Update a hub's state directly from a real-time event.
   */
  updateHubState(hubId: string, partialHub: Partial<AjaxHub>, source: 'sse' | 'sqs'): void {
    const hubData = this.data.hubs.get(hubId);
    if (!hubData) return;

    Object.assign(hubData.hub, partialHub);
    this.protectHubState(hubId, source);
    this.emit('hubStateChange', { hubId, hub: hubData.hub });
  }

  /**
   * Update a device's state directly from a real-time event.
   */
  updateDeviceState(hubId: string, deviceId: string, partialDevice: Partial<AjaxDevice>, source: 'sse' | 'sqs'): void {
    const hubData = this.data.hubs.get(hubId);
    if (!hubData) return;

    const device = hubData.devices.get(deviceId);
    if (!device) return;

    Object.assign(device, partialDevice);
    if (partialDevice.model) {
      device.model = { ...device.model, ...partialDevice.model };
    }
    this.protectDeviceState(deviceId, source);
    this.emit('deviceStateChange', { hubId, deviceId, device });
  }

  /**
   * Update a group's state directly from a real-time event.
   */
  updateGroupState(hubId: string, groupId: string, partialGroup: Partial<AjaxGroup>, source: 'sse' | 'sqs'): void {
    const hubData = this.data.hubs.get(hubId);
    if (!hubData) return;

    const group = hubData.groups.get(groupId);
    if (!group) return;

    Object.assign(group, partialGroup);
    this.emit('groupStateChange', { hubId, groupId, group });
  }

  /**
   * Update polling config at runtime.
   */
  updatePollingConfig(config: Partial<PollingConfig>): void {
    Object.assign(this.pollingConfig, config);
    this.log('Polling config updated:', this.pollingConfig);
  }
}
