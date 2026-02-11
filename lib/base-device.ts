'use strict';

import Homey from 'homey';
import { AjaxApiClient } from './ajax-api';
import { AjaxCoordinator } from './ajax-coordinator';

/**
 * Base device class for all Ajax Systems devices.
 * Provides shared functionality for coordinator integration and state updates.
 */
export class AjaxBaseDevice extends Homey.Device {

  protected getApp(): any {
    return this.homey.app;
  }

  protected getApi(): AjaxApiClient {
    return this.getApp().getApi();
  }

  protected getCoordinator(): AjaxCoordinator {
    return this.getApp().getCoordinator();
  }

  protected getHubId(): string {
    return this.getData().hubId;
  }

  protected getDeviceId(): string {
    return this.getData().deviceId || this.getData().id;
  }

  /**
   * Safely set a capability value, only if the value has changed.
   */
  protected async safeSetCapability(capability: string, value: any): Promise<void> {
    if (!this.hasCapability(capability)) return;

    try {
      const current = this.getCapabilityValue(capability);
      if (current !== value) {
        await this.setCapabilityValue(capability, value);
      }
    } catch (err) {
      this.error(`Failed to set ${capability}:`, (err as Error).message);
    }
  }

  /**
   * Wait for the coordinator to be ready. Sensor devices need the coordinator
   * (API mode) to function. In SIA-only mode, sensor devices remain unavailable.
   */
  protected async waitForApp(maxWaitMs: number = 30_000): Promise<boolean> {
    const start = Date.now();
    while (!this.getApp().getCoordinator()) {
      if (Date.now() - start > maxWaitMs) {
        this.error('Timed out waiting for coordinator');
        return false;
      }
      await new Promise(resolve => this.homey.setTimeout(resolve, 1000));
    }
    return true;
  }
}
