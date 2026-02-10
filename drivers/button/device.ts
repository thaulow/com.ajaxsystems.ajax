'use strict';

import { AjaxBaseDevice } from '../../lib/base-device';
import { AjaxDevice } from '../../lib/types';
import { signalLevelToPercent } from '../../lib/util';

module.exports = class ButtonDevice extends AjaxBaseDevice {

  private deviceListenerBound: ((data: any) => void) | null = null;

  async onInit(): Promise<void> {
    this.log('Button device init:', this.getName());

    const ready = await this.waitForApp();
    if (!ready) {
      this.setUnavailable('App not ready').catch(this.error);
      return;
    }

    const coordinator = this.getCoordinator();
    this.deviceListenerBound = (data: any) => {
      if (data.hubId === this.getHubId() && data.deviceId === this.getDeviceId()) {
        this.updateCapabilities(data.device);
      }
    };
    coordinator.on('deviceStateChange', this.deviceListenerBound);
    coordinator.on('dataUpdated', () => this.updateFromCoordinator());
    this.updateFromCoordinator();
  }

  async onUninit(): Promise<void> {
    if (this.deviceListenerBound) {
      this.getCoordinator()?.removeListener('deviceStateChange', this.deviceListenerBound);
    }
  }

  private updateFromCoordinator(): void {
    const device = this.getCoordinator().getDevice(this.getHubId(), this.getDeviceId());
    if (device) this.updateCapabilities(device);
  }

  private async updateCapabilities(device: AjaxDevice): Promise<void> {
    const model = device.model || {};

    // Button last event
    const lastEvent = model.lastEvent || model.state || '';
    if (lastEvent) {
      await this.safeSetCapability('ajax_button_pressed', String(lastEvent));
    }

    await this.safeSetCapability('measure_battery', device.batteryChargeLevelPercentage ?? null);
    await this.safeSetCapability('ajax_signal_strength', signalLevelToPercent(device.signalLevel));

    if (device.online) {
      this.setAvailable().catch(this.error);
    } else {
      this.setUnavailable('Device offline').catch(this.error);
    }
  }
};
