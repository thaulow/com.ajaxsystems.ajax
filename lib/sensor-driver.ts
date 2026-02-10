'use strict';

import Homey from 'homey';
import { DeviceCategory } from './types';
import { categorizeDevice } from './util';

/**
 * Base driver class for Ajax sensor/device drivers.
 * Provides shared pairing logic that filters devices by category.
 */
export class AjaxSensorDriver extends Homey.Driver {

  protected deviceCategory: DeviceCategory = 'unknown';

  async onInit(): Promise<void> {
    this.log(`${this.deviceCategory} driver initialized`);
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    session.setHandler('list_devices', async () => {
      const app = this.homey.app as any;
      if (!app?.isReady()) {
        throw new Error('App not ready. Please add a hub first and wait for initial sync.');
      }

      const coordinator = app.getCoordinator();
      const devices: any[] = [];

      for (const hubId of coordinator.getAllHubIds()) {
        const hub = coordinator.getHub(hubId);
        const allDevices = coordinator.getAllDevicesForHub(hubId);

        for (const device of allDevices) {
          const category = categorizeDevice(device.deviceType);
          if (category !== this.deviceCategory) continue;

          const name = device.roomName
            ? `${device.deviceName} (${device.roomName})`
            : device.deviceName;

          devices.push({
            name,
            data: {
              id: device.id,
              deviceId: device.id,
              hubId,
            },
            store: {
              deviceType: device.deviceType,
              roomName: device.roomName || '',
              hubName: hub?.name || '',
            },
          });
        }
      }

      if (devices.length === 0) {
        throw new Error(`No ${this.deviceCategory.replace(/_/g, ' ')} devices found.`);
      }

      return devices;
    });
  }
}

/**
 * Base device class for Ajax sensor/device devices.
 * Provides shared coordinator integration for device state updates.
 */
export { AjaxBaseDevice } from './base-device';
