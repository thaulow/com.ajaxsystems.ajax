'use strict';

import Homey from 'homey';

module.exports = class CameraDriver extends Homey.Driver {

  async onInit(): Promise<void> {
    this.log('Camera driver initialized');
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    session.setHandler('list_devices', async () => {
      const app = this.homey.app as any;
      if (!app?.isReady()) {
        throw new Error('App not ready. Please add a hub first and wait for initial sync.');
      }

      const api = app.getApi();
      const coordinator = app.getCoordinator();
      if (!api || !coordinator) {
        throw new Error('API not available. Please configure credentials first.');
      }

      const devices: any[] = [];

      for (const hubId of coordinator.getAllHubIds()) {
        const hub = coordinator.getHub(hubId);
        try {
          const videoEdges = await api.getVideoEdges(hubId);
          for (const ve of videoEdges) {
            const id = ve.id || ve.deviceId;
            const name = ve.name || ve.deviceName || `Camera ${(id || '').substring(0, 6)}`;
            const type = ve.type || ve.deviceType || 'UNKNOWN';

            // Extract network info
            const network = ve.networkInterface || {};
            const ethernet = network.ethernet || {};
            const wifi = network.wifi || {};
            const ipAddress = ethernet.configuration?.v4?.address
              || wifi.configuration?.v4?.address
              || ve.ipAddress || '';
            const macAddress = ethernet.macAddress || wifi.macAddress || ve.macAddress || '';

            // Extract firmware
            const firmware = ve.firmware || {};
            const firmwareVersion = firmware.currentVersion || firmware.version || '';

            // Extract channels (for NVR)
            const channels = ve.channels || [];

            devices.push({
              name: hub ? `${name} (${hub.name})` : name,
              data: {
                id,
                videoEdgeId: id,
                hubId,
              },
              store: {
                videoEdgeType: type,
                ipAddress,
                macAddress,
                firmwareVersion,
                hubName: hub?.name || '',
                channelCount: channels.length,
                rtspPort: 8554,
                onvifPort: 8080,
              },
            });
          }
        } catch (err) {
          this.log(`No video edges for hub ${hubId}:`, (err as Error).message);
        }
      }

      if (devices.length === 0) {
        throw new Error('No Ajax cameras found. Make sure your cameras are connected to an Ajax Hub.');
      }

      return devices;
    });
  }
};
