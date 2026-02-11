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
  private siaConnectedBound: ((address: string) => void) | null = null;
  private siaDisconnectedBound: ((address: string) => void) | null = null;
  private siaServerReadyBound: ((server: any) => void) | null = null;
  private siaHeartbeatTimer: any = null;
  private siaServerRef: any = null;

  async onInit(): Promise<void> {
    this.log('Hub device init:', this.getName());

    const connectionMode = this.getStoreValue('connectionMode');

    // Migrate capabilities for existing SIA devices (added in v1.0.11)
    // Only SIA mode uses these sensor capabilities; API mode has its own set.
    if (connectionMode === 'sia') {
      const requiredCaps = [
        'alarm_generic', 'alarm_fire', 'alarm_water', 'alarm_co',
        'alarm_battery', 'ajax_ac_power', 'ajax_device_lost',
        'ajax_rf_interference', 'ajax_last_event',
      ];
      for (const cap of requiredCaps) {
        if (!this.hasCapability(cap)) {
          await this.addCapability(cap).catch(this.error);
        }
      }
    }

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
      // Remove the app-level siaServerReady listener
      if (this.siaServerReadyBound) {
        const app = this.getApp();
        app?.removeListener?.('siaServerReady', this.siaServerReadyBound);
        this.siaServerReadyBound = null;
      }
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

    // SIA is receive-only (hub → Homey). Make interactive capabilities
    // read-only so they display as sensors instead of controls.
    await this.setCapabilityOptions('ajax_night_mode', {
      uiComponent: 'sensor',
      setable: false,
    }).catch(this.error);

    await this.setCapabilityOptions('homealarm_state', {
      setable: false,
    }).catch(this.error);

    // Set initial state
    await this.safeSetCapability('homealarm_state', 'disarmed');
    await this.safeSetCapability('ajax_night_mode', false);
    await this.safeSetCapability('alarm_generic', false);
    await this.safeSetCapability('alarm_fire', false);
    await this.safeSetCapability('alarm_water', false);
    await this.safeSetCapability('alarm_co', false);
    await this.safeSetCapability('alarm_tamper', false);
    await this.safeSetCapability('alarm_battery', false);
    await this.safeSetCapability('ajax_ac_power', true);
    await this.safeSetCapability('ajax_device_lost', false);
    await this.safeSetCapability('ajax_rf_interference', false);
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
      this.siaServerReadyBound = (server: any) => {
        this.subscribeSiaEvents(server);
        this.safeSetCapability('ajax_connection_state', true);
        this.setAvailable().catch(this.error);
      };
      app.on?.('siaServerReady', this.siaServerReadyBound);
    }
  }

  private subscribeSiaEvents(siaServer: any): void {
    this.cleanupSiaListeners();

    this.siaServerRef = siaServer;

    const accountId = this.getStoreValue('siaAccountId');

    // Normalize account ID for lenient comparison (strip leading zeros)
    const normalizedAccountId = accountId ? (accountId.replace(/^0+/, '') || '0') : '';

    this.siaEventBound = (event: SiaAlarmEvent) => {
      // Only handle events for our account (lenient: strip leading zeros)
      if (normalizedAccountId) {
        const eventAcct = (event.account || '').replace(/^0+/, '') || '0';
        if (normalizedAccountId !== eventAcct) return;
      }
      this.onSiaEvent(event);
    };

    this.siaHeartbeatBound = (account: string) => {
      if (normalizedAccountId) {
        const heartbeatAcct = (account || '').replace(/^0+/, '') || '0';
        if (normalizedAccountId !== heartbeatAcct) return;
      }
      this.onSiaHeartbeat();
    };

    this.siaConnectedBound = (address: string) => {
      this.log('SIA hub connected from:', address);
      this.safeSetCapability('ajax_connection_state', true);
      this.setAvailable().catch(this.error);
      this.resetSiaHeartbeatTimer();
    };

    this.siaDisconnectedBound = (address: string) => {
      this.log('SIA hub disconnected:', address);
    };

    siaServer.on('event', this.siaEventBound);
    siaServer.on('heartbeat', this.siaHeartbeatBound);
    siaServer.on('connected', this.siaConnectedBound);
    siaServer.on('disconnected', this.siaDisconnectedBound);

    // Start heartbeat watchdog
    this.resetSiaHeartbeatTimer();
  }

  private cleanupSiaListeners(): void {
    if (this.siaHeartbeatTimer) {
      this.homey.clearTimeout(this.siaHeartbeatTimer);
      this.siaHeartbeatTimer = null;
    }

    // Actually remove listeners from the SIA server EventEmitter
    const server = this.siaServerRef;
    if (server) {
      if (this.siaEventBound) server.removeListener('event', this.siaEventBound);
      if (this.siaHeartbeatBound) server.removeListener('heartbeat', this.siaHeartbeatBound);
      if (this.siaConnectedBound) server.removeListener('connected', this.siaConnectedBound);
      if (this.siaDisconnectedBound) server.removeListener('disconnected', this.siaDisconnectedBound);
      this.siaServerRef = null;
    }

    this.siaEventBound = null;
    this.siaHeartbeatBound = null;
    this.siaConnectedBound = null;
    this.siaDisconnectedBound = null;
  }

  private onSiaEvent(event: SiaAlarmEvent): void {
    this.log(`SIA event received: ${event.type} - ${event.description} (zone ${event.zone})`);

    this.resetSiaHeartbeatTimer();

    // Build event description for the last event capability
    const zoneInfo = event.zone > 0 ? ` (zone ${event.zone})` : '';
    const eventText = `${event.description}${zoneInfo}`;
    this.safeSetCapability('ajax_last_event', eventText);

    switch (event.type) {
      // ── Arming ─────────────────────────────────
      case 'arm':
        this.safeSetCapability('homealarm_state', 'armed');
        this.safeSetCapability('ajax_night_mode', false);
        this.clearAllAlarms();
        this.triggerCard('hub_armed', { hub_name: this.getName() });
        break;

      case 'disarm':
        this.safeSetCapability('homealarm_state', 'disarmed');
        this.safeSetCapability('ajax_night_mode', false);
        this.clearAllAlarms();
        this.triggerCard('hub_disarmed', { hub_name: this.getName() });
        break;

      case 'night_arm':
        this.safeSetCapability('ajax_night_mode', true);
        this.triggerCard('night_mode_armed', { zone: event.zone, description: event.description });
        break;

      case 'night_disarm':
        this.safeSetCapability('ajax_night_mode', false);
        this.triggerCard('night_mode_disarmed', { zone: event.zone, description: event.description });
        break;

      case 'partial_arm':
        this.safeSetCapability('homealarm_state', 'partially_armed');
        this.triggerCard('hub_armed', { hub_name: this.getName() });
        break;

      case 'group_arm':
        this.triggerCard('group_armed', { zone: event.zone, description: event.description });
        break;

      case 'group_disarm':
        this.triggerCard('group_disarmed', { zone: event.zone, description: event.description });
        break;

      case 'armed_with_faults':
        this.safeSetCapability('homealarm_state', 'armed');
        this.triggerCard('armed_with_faults', { zone: event.zone, description: event.description });
        break;

      case 'arming_failed':
        this.triggerCard('arming_failed', { zone: event.zone, description: event.description });
        break;

      // ── Alarms ─────────────────────────────────
      case 'alarm':
        this.safeSetCapability('alarm_generic', true);
        if (event.category === 'fire') {
          this.safeSetCapability('alarm_fire', true);
          this.triggerCard('fire_alarm_triggered', { zone: event.zone, description: event.description });
        } else if (event.category === 'water') {
          this.safeSetCapability('alarm_water', true);
          this.triggerCard('water_alarm_triggered', { zone: event.zone, description: event.description });
        } else if (event.category === 'gas') {
          this.safeSetCapability('alarm_co', true);
          this.triggerCard('gas_co_alarm', { zone: event.zone, description: event.description });
        } else if (event.category === 'burglary') {
          this.triggerCard('burglary_alarm', { zone: event.zone, description: event.description });
        } else if (event.category === 'medical') {
          this.triggerCard('medical_alarm', { zone: event.zone, description: event.description });
        }
        break;

      case 'alarm_restore':
        if (event.category === 'fire') this.safeSetCapability('alarm_fire', false);
        else if (event.category === 'water') this.safeSetCapability('alarm_water', false);
        else if (event.category === 'gas') this.safeSetCapability('alarm_co', false);
        this.checkAndClearGenericAlarm();
        this.triggerCard('alarm_restored', {
          zone: event.zone,
          alarm_type: event.category || 'unknown',
          description: event.description,
        });
        break;

      // ── Panic & Duress ─────────────────────────
      case 'panic':
        this.safeSetCapability('alarm_generic', true);
        this.triggerCard('panic_alarm', { zone: event.zone, description: event.description });
        break;

      case 'duress':
        this.safeSetCapability('homealarm_state', 'disarmed');
        this.safeSetCapability('ajax_night_mode', false);
        this.safeSetCapability('alarm_generic', true);
        this.triggerCard('duress_alarm', { zone: event.zone, description: event.description });
        break;

      // ── Tamper ─────────────────────────────────
      case 'tamper':
        this.safeSetCapability('alarm_tamper', true);
        this.safeSetCapability('alarm_generic', true);
        this.triggerCard('tamper_alarm', { zone: event.zone, description: event.description });
        break;

      case 'tamper_restore':
        this.safeSetCapability('alarm_tamper', false);
        this.checkAndClearGenericAlarm();
        this.triggerCard('tamper_restored', { zone: event.zone, description: event.description });
        break;

      // ── Power / Battery ────────────────────────
      case 'power_trouble':
        this.safeSetCapability('alarm_battery', true);
        if (event.code === '301' || event.code === '337') {
          this.safeSetCapability('ajax_ac_power', false);
        }
        this.triggerCard('power_trouble', {
          zone: event.zone,
          trouble_type: event.description,
          description: event.description,
        });
        break;

      case 'power_restore':
        this.safeSetCapability('alarm_battery', false);
        if (event.code === '301' || event.code === '337') {
          this.safeSetCapability('ajax_ac_power', true);
        }
        this.triggerCard('power_restored', {
          zone: event.zone,
          trouble_type: event.description,
          description: event.description,
        });
        break;

      // ── Device Communication ───────────────────
      case 'device_lost':
        this.safeSetCapability('ajax_device_lost', true);
        this.triggerCard('device_connection_lost', { zone: event.zone, description: event.description });
        break;

      case 'device_restore':
        this.safeSetCapability('ajax_device_lost', false);
        this.triggerCard('device_connection_restored', { zone: event.zone, description: event.description });
        break;

      // ── Trouble ────────────────────────────────
      case 'trouble':
        this.safeSetCapability('alarm_generic', true);
        if (event.code === '344') this.safeSetCapability('ajax_rf_interference', true);
        this.triggerCard('trouble_event', {
          zone: event.zone,
          trouble_type: event.description,
          description: event.description,
        });
        break;

      case 'trouble_restore':
        if (event.code === '344') this.safeSetCapability('ajax_rf_interference', false);
        this.checkAndClearGenericAlarm();
        this.triggerCard('trouble_restored', {
          zone: event.zone,
          trouble_type: event.description,
          description: event.description,
        });
        break;

      // ── Bypass ─────────────────────────────────
      case 'bypass':
        this.triggerCard('zone_bypassed', { zone: event.zone, description: event.description });
        break;

      case 'unbypass':
        this.triggerCard('zone_unbypassed', { zone: event.zone, description: event.description });
        break;

      // ── System & Test ──────────────────────────
      case 'system':
        this.triggerCard('system_event', { event_type: event.description, description: event.description });
        break;

      case 'test':
        this.triggerCard('system_event', { event_type: 'Automatic test', description: event.description });
        break;
    }

    // Always fire the generic catch-all flow card for every event
    this.triggerCard('alarm_event', {
      hub_name: this.getName(),
      event_type: event.type,
      device_name: `Zone ${event.zone}`,
      room_name: '',
      description: event.description,
    });

    // Update connection state - we're receiving events
    this.safeSetCapability('ajax_connection_state', true);
    this.setAvailable().catch(this.error);
  }

  private onSiaHeartbeat(): void {
    this.resetSiaHeartbeatTimer();
    this.safeSetCapability('ajax_connection_state', true);
    this.setAvailable().catch(this.error);
  }

  private triggerCard(cardId: string, tokens: Record<string, any>): void {
    this.homey.flow.getTriggerCard(cardId)
      ?.trigger(this, tokens)
      .catch(this.error);
  }

  private clearAllAlarms(): void {
    this.safeSetCapability('alarm_generic', false);
    this.safeSetCapability('alarm_fire', false);
    this.safeSetCapability('alarm_water', false);
    this.safeSetCapability('alarm_co', false);
    this.safeSetCapability('alarm_tamper', false);
  }

  private checkAndClearGenericAlarm(): void {
    const fire = this.getCapabilityValue('alarm_fire');
    const water = this.getCapabilityValue('alarm_water');
    const tamper = this.getCapabilityValue('alarm_tamper');
    const co = this.getCapabilityValue('alarm_co');
    if (!fire && !water && !tamper && !co) {
      this.safeSetCapability('alarm_generic', false);
    }
  }

  /**
   * Get the heartbeat timeout in ms based on the configured ping interval.
   * Returns 0 if "connect on demand" mode (no periodic heartbeats expected).
   */
  private getSiaHeartbeatTimeoutMs(): number {
    // siaPingIntervalMinutes: 0 = connect on demand (no timeout), 1-1440 = ping interval
    const pingMinutes = this.getStoreValue('siaPingIntervalMinutes') || 0;
    if (pingMinutes <= 0) return 0; // Connect on demand - no heartbeat watchdog
    // Allow 3 missed heartbeats before marking offline
    return pingMinutes * 60_000 * 3;
  }

  private resetSiaHeartbeatTimer(): void {
    if (this.siaHeartbeatTimer) {
      this.homey.clearTimeout(this.siaHeartbeatTimer);
      this.siaHeartbeatTimer = null;
    }
    const timeoutMs = this.getSiaHeartbeatTimeoutMs();
    if (timeoutMs <= 0) return; // Connect on demand - no watchdog
    this.siaHeartbeatTimer = this.homey.setTimeout(() => {
      this.log('SIA heartbeat timeout - hub may be offline');
      this.safeSetCapability('ajax_connection_state', false);
      this.setUnavailable('No heartbeat received from hub').catch(this.error);
    }, timeoutMs);
  }

  // ============================================================
  // API Mode
  // ============================================================

  private async initApiMode(): Promise<void> {
    // Ensure capabilities are interactive (in case device was previously SIA)
    await this.setCapabilityOptions('ajax_night_mode', {
      uiComponent: 'toggle',
      setable: true,
    }).catch(this.error);

    await this.setCapabilityOptions('homealarm_state', {
      setable: true,
    }).catch(this.error);

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
