'use strict';

import { AjaxBaseDevice } from '../../lib/base-device';
import { AjaxDevice } from '../../lib/types';
import { isSwitchOn, isTampered, signalLevelToPercent } from '../../lib/util';

module.exports = class SmartPlugDevice extends AjaxBaseDevice {

  private deviceListenerBound: ((data: any) => void) | null = null;

  async onInit(): Promise<void> {
    this.log('Smart plug init:', this.getName());

    // Register on/off listener
    this.registerCapabilityListener('onoff', async (value: boolean) => {
      await this.onOnOff(value);
    });

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

    await this.safeSetCapability('onoff', isSwitchOn(device));
    await this.safeSetCapability('alarm_tamper', isTampered(device));
    await this.safeSetCapability('measure_battery', device.batteryChargeLevelPercentage ?? null);
    await this.safeSetCapability('ajax_signal_strength', signalLevelToPercent(device.signalLevel));

    // Power monitoring (Socket only)
    if (model.activePower !== undefined) {
      await this.safeSetCapability('measure_power', model.activePower);
    }
    if (model.energy !== undefined) {
      // Convert Wh to kWh
      await this.safeSetCapability('meter_power', model.energy / 1000);
    }
    if (model.voltage !== undefined) {
      await this.safeSetCapability('measure_voltage', model.voltage);
    }

    if (device.online) {
      this.setAvailable().catch(this.error);
    } else {
      this.setUnavailable('Device offline').catch(this.error);
    }
  }

  private async onOnOff(value: boolean): Promise<void> {
    const api = this.getApi();
    const hubId = this.getHubId();
    const deviceId = this.getDeviceId();
    const deviceType = this.getStoreValue('deviceType') || '';

    const command = value ? 'SWITCH_ON' : 'SWITCH_OFF';
    await api.sendDeviceCommand(hubId, deviceId, command as any, deviceType);
    this.getCoordinator().refresh().catch(this.error);
  }
};
