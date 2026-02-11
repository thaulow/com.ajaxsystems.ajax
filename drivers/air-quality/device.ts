'use strict';

import { AjaxBaseDevice } from '../../lib/base-device';
import { AjaxDevice } from '../../lib/types';
import { signalLevelToPercent } from '../../lib/util';

module.exports = class AirQualityDevice extends AjaxBaseDevice {

  private deviceListenerBound: ((data: any) => void) | null = null;
  private dataUpdatedBound: (() => void) | null = null;

  async onInit(): Promise<void> {
    this.log('Air quality sensor init:', this.getName());

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
    this.dataUpdatedBound = () => this.updateFromCoordinator();
    coordinator.on('dataUpdated', this.dataUpdatedBound);
    this.updateFromCoordinator();
  }

  async onUninit(): Promise<void> {
    const coordinator = this.getCoordinator();
    if (coordinator && this.deviceListenerBound) {
      coordinator.removeListener('deviceStateChange', this.deviceListenerBound);
    }
    if (coordinator && this.dataUpdatedBound) {
      coordinator.removeListener('dataUpdated', this.dataUpdatedBound);
    }
  }

  private updateFromCoordinator(): void {
    const device = this.getCoordinator().getDevice(this.getHubId(), this.getDeviceId());
    if (device) this.updateCapabilities(device);
  }

  private async updateCapabilities(device: AjaxDevice): Promise<void> {
    const model = device.model || {};

    await this.safeSetCapability('measure_temperature', device.temperature ?? model.temperature ?? null);
    await this.safeSetCapability('measure_humidity', model.humidity ?? null);
    await this.safeSetCapability('measure_co2', model.co2 ?? model.carbonDioxide ?? null);
    await this.safeSetCapability('measure_battery', device.batteryChargeLevelPercentage ?? null);
    await this.safeSetCapability('ajax_signal_strength', signalLevelToPercent(device.signalLevel));

    if (device.online) {
      this.setAvailable().catch(this.error);
    } else {
      this.setUnavailable('Device offline').catch(this.error);
    }
  }
};
