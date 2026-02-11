'use strict';

import { AjaxBaseDevice } from '../../lib/base-device';
import { AjaxDevice } from '../../lib/types';
import { isContactOpen, isExtraContactOpen, isTampered, signalLevelToPercent } from '../../lib/util';

module.exports = class ContactSensorDevice extends AjaxBaseDevice {

  private deviceListenerBound: ((data: any) => void) | null = null;
  private dataUpdatedBound: (() => void) | null = null;

  async onInit(): Promise<void> {
    this.log('Contact sensor init:', this.getName());

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
    this.dataUpdatedBound = () => this.updateFromCoordinator();
    coordinator.on('deviceStateChange', this.deviceListenerBound);
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
    await this.safeSetCapability('alarm_contact', isContactOpen(device));
    await this.safeSetCapability('alarm_tamper', isTampered(device));
    await this.safeSetCapability('measure_battery', device.batteryChargeLevelPercentage ?? null);
    await this.safeSetCapability('measure_temperature', device.temperature ?? null);
    await this.safeSetCapability('ajax_signal_strength', signalLevelToPercent(device.signalLevel));

    // Only show external contact for devices that actually use the input (DoorProtect Plus)
    const model = device.model || {};
    const hasExternalContact = model.extraContactAware === true || 'externalContactState' in model;
    if (hasExternalContact) {
      if (!this.hasCapability('ajax_extra_contact')) {
        await this.addCapability('ajax_extra_contact').catch(this.error);
      }
      await this.safeSetCapability('ajax_extra_contact', isExtraContactOpen(device));
    } else if (this.hasCapability('ajax_extra_contact')) {
      await this.removeCapability('ajax_extra_contact').catch(this.error);
    }

    if (device.online) {
      this.setAvailable().catch(this.error);
    } else {
      this.setUnavailable('Device offline').catch(this.error);
    }
  }
};
