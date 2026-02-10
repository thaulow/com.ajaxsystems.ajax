'use strict';

import { AjaxBaseDevice } from '../../lib/base-device';
import { AjaxHub } from '../../lib/types';
import { SiaAlarmEvent } from '../../lib/sia-server';
import {
  armingStateToHomey,
  parseArmingState,
  signalLevelToPercent,
} from '../../lib/util';

module.exports = class HubDevice extends AjaxBaseDevice {

  private hubListenerBound: ((data: any) => void) | null = null;
  private onlineListenerBound: ((data: any) => void) | null = null;
  private siaEventBound: ((event: SiaAlarmEvent) => void) | null = null;
  private siaHeartbeatBound: ((account: string) => void) | null = null;
  private siaHeartbeatTimer: any = null;
  private static readonly SIA_HEARTBEAT_TIMEOUT_MS = 300_000; // 5 minutes

  async onInit(): Promise<void> {
    this.log('Hub device init:', this.getName());

    const connectionMode = this.getStoreValue('connectionMode');

    if (connectionMode === 'sia') {
      await this.initSiaMode();
    } else {
      await this.initApiMode();
    }
  }

  async onUninit(): Promise<void> {
    const connectionMode = this.getStoreValue('connectionMode');

    if (connectionMode === 'sia') {
      this.cleanupSiaListeners();
    } else {
      const coordinator = this.getCoordinator();
      if (coordinator && this.hubListenerBound) {
        coordinator.removeListener('hubStateChange', this.hubListenerBound);
      }
      if (coordinator && this.onlineListenerBound) {
        coordinator.removeListener('hubOnlineChange', this.onlineListenerBound);
      }
    }
  }

  // ============================================================
  // SIA Mode
  // ============================================================

  private async initSiaMode(): Promise<void> {
    this.log('Hub device running in SIA mode');

    // Register capability listeners (SIA is receive-only, commands are not available)
    this.registerCapabilityListener('homealarm_state', async () => {
      throw new Error('Arm/disarm is not available in SIA mode. Use the Ajax app or keypad to control your system.');
    });

    this.registerCapabilityListener('ajax_night_mode', async () => {
      throw new Error('Night mode control is not available in SIA mode. Use the Ajax app or keypad to control your system.');
    });

    // Set initial state
    await this.safeSetCapability('homealarm_state', 'disarmed');
    await this.safeSetCapability('ajax_night_mode', false);
    await this.safeSetCapability('alarm_generic', false);
    await this.safeSetCapability('alarm_fire', false);
    await this.safeSetCapability('alarm_water', false);
    await this.safeSetCapability('alarm_tamper', false);
    await this.safeSetCapability('ajax_connection_state', false);
    await this.safeSetCapability('ajax_last_event', 'Waiting for events...');

    // Subscribe to SIA events from the app
    const app = this.getApp();
    if (app?.getSiaServer) {
      const siaServer = app.getSiaServer();
      if (siaServer) {
        this.subscribeSiaEvents(siaServer);
        if (siaServer.isRunning()) {
          await this.safeSetCapability('ajax_connection_state', true);
          this.setAvailable().catch(this.error);
        }
      } else {
        this.log('SIA server not yet started, waiting...');
      }
    }

    // Also listen for when the SIA server is (re)started
    if (app) {
      const onSiaReady = (server: any) => {
        this.subscribeSiaEvents(server);
        this.safeSetCapability('ajax_connection_state', true);
        this.setAvailable().catch(this.error);
      };
      app.on?.('siaServerReady', onSiaReady);
    }
  }

  private subscribeSiaEvents(siaServer: any): void {
    this.cleanupSiaListeners();

    const accountId = this.getStoreValue('siaAccountId');

    this.siaEventBound = (event: SiaAlarmEvent) => {
      // Only handle events for our account
      if (accountId && event.account !== accountId) return;
      this.onSiaEvent(event);
    };

    this.siaHeartbeatBound = (account: string) => {
      if (accountId && account !== accountId) return;
      this.onSiaHeartbeat();
    };

    siaServer.on('event', this.siaEventBound);
    siaServer.on('heartbeat', this.siaHeartbeatBound);

    // Start heartbeat watchdog
    this.resetSiaHeartbeatTimer();
  }

  private cleanupSiaListeners(): void {
    if (this.siaHeartbeatTimer) {
      this.homey.clearTimeout(this.siaHeartbeatTimer);
      this.siaHeartbeatTimer = null;
    }
    this.siaEventBound = null;
    this.siaHeartbeatBound = null;
  }

  private onSiaEvent(event: SiaAlarmEvent): void {
    this.log(`SIA event received: ${event.type} - ${event.description} (zone ${event.zone})`);

    this.resetSiaHeartbeatTimer();

    // Build event description for the last event capability
    const zoneInfo = event.zone > 0 ? ` (zone ${event.zone})` : '';
    const eventText = `${event.description}${zoneInfo}`;
    this.safeSetCapability('ajax_last_event', eventText);

    switch (event.type) {
      case 'arm':
        this.safeSetCapability('homealarm_state', 'armed');
        this.safeSetCapability('ajax_night_mode', false);
        // Clear alarms on arm
        this.safeSetCapability('alarm_generic', false);
        this.safeSetCapability('alarm_fire', false);
        this.safeSetCapability('alarm_water', false);
        this.safeSetCapability('alarm_tamper', false);
        break;

      case 'disarm':
        this.safeSetCapability('homealarm_state', 'disarmed');
        this.safeSetCapability('ajax_night_mode', false);
        // Clear alarms on disarm
        this.safeSetCapability('alarm_generic', false);
        this.safeSetCapability('alarm_fire', false);
        this.safeSetCapability('alarm_water', false);
        this.safeSetCapability('alarm_tamper', false);
        break;

      case 'night_arm':
        this.safeSetCapability('ajax_night_mode', true);
        break;

      case 'night_disarm':
        this.safeSetCapability('ajax_night_mode', false);
        break;

      case 'partial_arm':
        this.safeSetCapability('homealarm_state', 'partially_armed');
        break;

      case 'tamper':
        this.safeSetCapability('alarm_tamper', true);
        this.safeSetCapability('alarm_generic', true);
        break;

      case 'tamper_restore':
        this.safeSetCapability('alarm_tamper', false);
        break;

      case 'alarm':
        // Set the generic alarm
        this.safeSetCapability('alarm_generic', true);

        // Set specific alarm type based on CID category
        if (event.category === 'fire') {
          this.safeSetCapability('alarm_fire', true);
        } else if (event.category === 'water') {
          this.safeSetCapability('alarm_water', true);
        }

        // Trigger the alarm flow card
        this.homey.flow.getTriggerCard('alarm_event')
          ?.trigger(this, {
            event_type: event.category || 'alarm',
            device_name: `Zone ${event.zone}`,
            description: event.description,
          })
          .catch(this.error);
        break;

      case 'alarm_restore':
        // Clear specific alarm type based on CID category
        if (event.category === 'fire') {
          this.safeSetCapability('alarm_fire', false);
        } else if (event.category === 'water') {
          this.safeSetCapability('alarm_water', false);
        }
        // Check if all alarms are cleared
        this.checkAndClearGenericAlarm();
        break;

      case 'trouble':
        this.safeSetCapability('alarm_generic', true);
        break;

      case 'trouble_restore':
        this.checkAndClearGenericAlarm();
        break;

      case 'test':
        this.log('SIA supervision/test event received');
        break;
    }

    // Update connection state - we're receiving events
    this.safeSetCapability('ajax_connection_state', true);
    this.setAvailable().catch(this.error);
  }

  private onSiaHeartbeat(): void {
    this.resetSiaHeartbeatTimer();
    this.safeSetCapability('ajax_connection_state', true);
    this.setAvailable().catch(this.error);
  }

  private checkAndClearGenericAlarm(): void {
    const fire = this.getCapabilityValue('alarm_fire');
    const water = this.getCapabilityValue('alarm_water');
    const tamper = this.getCapabilityValue('alarm_tamper');
    if (!fire && !water && !tamper) {
      this.safeSetCapability('alarm_generic', false);
    }
  }

  private resetSiaHeartbeatTimer(): void {
    if (this.siaHeartbeatTimer) {
      this.homey.clearTimeout(this.siaHeartbeatTimer);
    }
    this.siaHeartbeatTimer = this.homey.setTimeout(() => {
      this.log('SIA heartbeat timeout - hub may be offline');
      this.safeSetCapability('ajax_connection_state', false);
      this.setUnavailable('No heartbeat received from hub').catch(this.error);
    }, HubDevice.SIA_HEARTBEAT_TIMEOUT_MS);
  }

  // ============================================================
  // API Mode
  // ============================================================

  private async initApiMode(): Promise<void> {
    // Register capability listeners
    this.registerCapabilityListener('homealarm_state', async (value: string) => {
      await this.onAlarmStateSet(value);
    });

    this.registerCapabilityListener('ajax_night_mode', async (value: boolean) => {
      await this.onNightModeSet(value);
    });

    // Wait for app and connect to coordinator
    const ready = await this.waitForApp();
    if (!ready) {
      this.setUnavailable('App not ready').catch(this.error);
      return;
    }

    // Subscribe to coordinator events
    const coordinator = this.getCoordinator();
    this.hubListenerBound = (data: any) => this.onHubStateChange(data);
    this.onlineListenerBound = (data: any) => this.onHubOnlineChange(data);
    coordinator.on('hubStateChange', this.hubListenerBound);
    coordinator.on('hubOnlineChange', this.onlineListenerBound);
    coordinator.on('dataUpdated', () => this.updateFromCoordinator());

    // Initial update
    this.updateFromCoordinator();
  }

  // ============================================================
  // State Updates (API mode)
  // ============================================================

  private async updateFromCoordinator(): Promise<void> {
    const hub = this.getCoordinator().getHub(this.getHubId());
    if (!hub) return;
    await this.updateCapabilities(hub);
  }

  private async onHubStateChange(data: { hubId: string; hub: AjaxHub }): Promise<void> {
    if (data.hubId !== this.getHubId()) return;
    await this.updateCapabilities(data.hub);
  }

  private async onHubOnlineChange(data: { hubId: string; hub: AjaxHub }): Promise<void> {
    if (data.hubId !== this.getHubId()) return;

    if (!data.hub.online) {
      this.setUnavailable('Hub is offline').catch(this.error);
    } else {
      this.setAvailable().catch(this.error);
    }
  }

  private async updateCapabilities(hub: AjaxHub): Promise<void> {
    const { nightMode } = parseArmingState(hub.state);
    const homeyState = armingStateToHomey(hub.state);

    await this.safeSetCapability('homealarm_state', homeyState);
    await this.safeSetCapability('ajax_night_mode', nightMode);
    await this.safeSetCapability('alarm_tamper', hub.tampered);
    await this.safeSetCapability('measure_battery', hub.battery?.chargeLevelPercentage ?? null);
    await this.safeSetCapability('ajax_gsm_signal', signalLevelToPercent(hub.gsm?.signalLevel));
    await this.safeSetCapability('ajax_wifi_signal', signalLevelToPercent(hub.wifi?.signalLevel));
    await this.safeSetCapability('ajax_connection_state', hub.online);
    await this.safeSetCapability('ajax_firmware_version', hub.firmware?.version || 'Unknown');

    if (hub.online) {
      this.setAvailable().catch(this.error);
    }
  }

  // ============================================================
  // Command Handlers (API mode)
  // ============================================================

  private async onAlarmStateSet(value: string): Promise<void> {
    const api = this.getApi();
    const hubId = this.getHubId();

    try {
      switch (value) {
        case 'armed':
          await api.setHubArming(hubId, 'ARM');
          break;
        case 'disarmed':
          await api.setHubArming(hubId, 'DISARM');
          break;
        case 'partially_armed':
          await api.setHubArming(hubId, 'ARM');
          break;
        default:
          throw new Error(`Unknown alarm state: ${value}`);
      }

      this.getCoordinator().refresh().catch(this.error);
    } catch (err) {
      this.error('Failed to set alarm state:', (err as Error).message);
      throw err;
    }
  }

  private async onNightModeSet(value: boolean): Promise<void> {
    const api = this.getApi();
    const hubId = this.getHubId();

    try {
      if (value) {
        await api.setHubArming(hubId, 'NIGHT_MODE_ON');
      } else {
        await api.setHubArming(hubId, 'NIGHT_MODE_OFF');
      }

      this.getCoordinator().refresh().catch(this.error);
    } catch (err) {
      this.error('Failed to set night mode:', (err as Error).message);
      throw err;
    }
  }

  // ============================================================
  // Data Accessors
  // ============================================================

  protected getHubId(): string {
    return this.getData().hubId || this.getData().id;
  }

};
