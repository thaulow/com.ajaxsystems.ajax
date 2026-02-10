'use strict';

import { AjaxBaseDevice } from '../../lib/base-device';
import { AjaxHub } from '../../lib/types';
import {
  armingStateToHomey,
  parseArmingState,
  signalLevelToPercent,
} from '../../lib/util';

module.exports = class HubDevice extends AjaxBaseDevice {

  private hubListenerBound: ((data: any) => void) | null = null;
  private onlineListenerBound: ((data: any) => void) | null = null;

  async onInit(): Promise<void> {
    this.log('Hub device init:', this.getName());

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

  async onUninit(): Promise<void> {
    const coordinator = this.getCoordinator();
    if (coordinator && this.hubListenerBound) {
      coordinator.removeListener('hubStateChange', this.hubListenerBound);
    }
    if (coordinator && this.onlineListenerBound) {
      coordinator.removeListener('hubOnlineChange', this.onlineListenerBound);
    }
  }

  // ============================================================
  // State Updates
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
  // Command Handlers
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
          // Partially armed is typically achieved through group-level arming
          // For hub-level, we'll just arm
          await api.setHubArming(hubId, 'ARM');
          break;
        default:
          throw new Error(`Unknown alarm state: ${value}`);
      }

      // Refresh state after command
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
