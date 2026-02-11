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
const STALE_DATA_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const FULL_POLL_INTERVAL = 10; // Every Nth poll fetches rooms, groups, hub detail

export class AjaxCoordinator extends EventEmitter {

  private api: AjaxApiClient;
  private homey: HomeyInstance;
  private log: (...args: any[]) => void;
  private error: (...args: any[]) => void;

  private pollingConfig: PollingConfig;
  private pollTimer: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private pollCount: number = 0;

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
      this.pollCount++;
      await this.fetchAllData();
      this.consecutiveErrors = 0;
    } catch (err) {
      this.consecutiveErrors++;

      if (err instanceof AjaxAuthError) {
        this.error('Authentication error during poll:', (err as Error).message);
        this.emit('authError', err);
        // Try re-login via the API client, then resume quickly
        try {
          await this.api.login();
          this.log('Re-login successful in coordinator, resuming poll in 2s');
          this.pollTimer = this.homey.setTimeout(() => this.poll(), 2000);
        } catch {
          this.pollTimer = this.homey.setTimeout(() => this.poll(), BACKOFF_MAX_MS);
        }
        return;
      }

      this.error(`Poll error (${this.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, (err as Error).message);

      if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        this.emit('unavailable', 'Too many consecutive errors');
      }

      // If data is stale (no successful poll in 5+ minutes), try re-login to recover
      const staleness = Date.now() - (this.data.lastUpdate || 0);
      if (staleness > STALE_DATA_THRESHOLD_MS && this.consecutiveErrors >= 3) {
        this.log(`Data is stale (${Math.round(staleness / 1000)}s), attempting re-login to recover`);
        try {
          await this.api.login();
          this.log('Recovery re-login successful, resuming poll in 2s');
          this.consecutiveErrors = 0;
          this.pollTimer = this.homey.setTimeout(() => this.poll(), 2000);
          return;
        } catch {
          this.error('Recovery re-login failed');
        }
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

    // Full poll (rooms, groups, hub detail) on first poll and every Nth after.
    // Lean polls only fetch hubs + devices to minimize API requests.
    const isFullPoll = this.pollCount <= 1 || this.pollCount % FULL_POLL_INTERVAL === 0;

    for (let hub of hubs) {
      const hubId = hub.id;
      const existingHubData = this.data.hubs.get(hubId);
      // First time seeing this hub always needs a full fetch
      const needsFull = isFullPoll || !existingHubData;

      // Fetch devices always; rooms, groups, hub detail only on full polls
      const [hubDetail, devices, rooms, groups] = await Promise.all([
        needsFull && this.api.isProxyMode() ? this.api.getHub(hubId).catch(() => null) : Promise.resolve(null),
        this.api.getDevices(hubId),
        needsFull ? this.api.getRooms(hubId) : Promise.resolve(null),
        needsFull && hub.groupsEnabled ? this.api.getGroups(hubId) : Promise.resolve(null),
      ]);

      // Merge detailed hub data over the list data (proxy mode)
      if (hubDetail) {
        hub = { ...hub, ...hubDetail, id: hubId, name: hub.name || hubDetail.name };
      }

      // Build device map (always fresh)
      const deviceMap = new Map<string, AjaxDevice>();
      for (const device of devices) {
        deviceMap.set(device.id, device);
      }

      // Rooms and groups: use fresh data on full poll, otherwise reuse cached
      const roomMap: Map<string, AjaxRoom> = rooms
        ? new Map(rooms.map((r: AjaxRoom) => [r.id, r] as const))
        : existingHubData?.rooms || new Map();

      const groupMap: Map<string, AjaxGroup> = groups
        ? new Map(groups.map((g: AjaxGroup) => [g.id, g] as const))
        : existingHubData?.groups || new Map();

      // Enrich device room names from room map
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

      // Check for group state changes (only meaningful on full polls)
      if (groups && existingHubData) {
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
