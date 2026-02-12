'use strict';

import Homey from 'homey';
import { AjaxBaseDevice } from '../../lib/base-device';

const RTSP_PORT = 8554;

module.exports = class CameraDevice extends AjaxBaseDevice {

  private image: Homey.Image | null = null;
  private dataUpdatedBound: (() => void) | null = null;

  async onInit(): Promise<void> {
    this.log('Camera init:', this.getName());

    // Register camera image
    this.image = await this.homey.images.createImage();
    this.image.setUrl(null); // Will be set when RTSP URL is available
    await this.setCameraImage('front', this.getName(), this.image);

    this.updateRtspUrl();

    const ready = await this.waitForApp();
    if (!ready) {
      this.setUnavailable('App not ready').catch(this.error);
      return;
    }

    const coordinator = this.getCoordinator();
    this.dataUpdatedBound = () => this.updateFromApi();
    coordinator.on('dataUpdated', this.dataUpdatedBound);
    this.updateFromApi();
  }

  async onUninit(): Promise<void> {
    const coordinator = this.getCoordinator();
    if (coordinator && this.dataUpdatedBound) {
      coordinator.removeListener('dataUpdated', this.dataUpdatedBound);
    }
  }

  async onSettings(event: { oldSettings: any; newSettings: any; changedKeys: string[] }): Promise<string | void> {
    if (event.changedKeys.includes('rtsp_username') || event.changedKeys.includes('rtsp_password')) {
      this.updateRtspUrl();
    }
  }

  private updateRtspUrl(): void {
    const ipAddress = this.getStoreValue('ipAddress');
    if (!ipAddress) return;

    const username = this.getSetting('rtsp_username') || '';
    const password = this.getSetting('rtsp_password') || '';
    const macAddress = (this.getStoreValue('macAddress') || '').replace(/:/g, '');
    const port = this.getStoreValue('rtspPort') || RTSP_PORT;

    // Build RTSP stream path: {mac}-0_{stream}
    const streamPath = macAddress ? `${macAddress}-0_m` : '0_m';
    const auth = username && password ? `${username}:${password}@` : '';
    const rtspUrl = `rtsp://${auth}${ipAddress}:${port}/${streamPath}`;

    this.log('RTSP URL configured:', `rtsp://${ipAddress}:${port}/${streamPath}`);

    if (this.image) {
      this.image.setUrl(null);
    }
  }

  private async updateFromApi(): Promise<void> {
    try {
      const api = this.getApi();
      const hubId = this.getHubId();
      const videoEdgeId = this.getData().videoEdgeId;

      const ve = await api.getVideoEdge(hubId, videoEdgeId);
      if (!ve) return;

      // Update connection state
      const online = ve.connectionState === 'ONLINE' || ve.online === true;
      await this.safeSetCapability('ajax_connection_state', online);

      // Update firmware
      const firmware = ve.firmware || {};
      const version = firmware.currentVersion || firmware.version || '';
      if (version) {
        await this.safeSetCapability('ajax_firmware_version', version);
      }
      const updateAvailable = firmware.newVersionAvailable === true
        || firmware.criticalUpdateAvailable === true;
      await this.safeSetCapability('ajax_firmware_update', updateAvailable);

      // Update IP address if changed
      const network = ve.networkInterface || {};
      const ethernet = network.ethernet || {};
      const wifi = network.wifi || {};
      const ipAddress = ethernet.configuration?.v4?.address
        || wifi.configuration?.v4?.address
        || ve.ipAddress || '';
      if (ipAddress && ipAddress !== this.getStoreValue('ipAddress')) {
        await this.setStoreValue('ipAddress', ipAddress);
        this.updateRtspUrl();
      }

      if (online) {
        this.setAvailable().catch(this.error);
      } else {
        this.setUnavailable('Camera offline').catch(this.error);
      }
    } catch (err) {
      this.error('Camera update error:', (err as Error).message);
    }
  }

  protected getHubId(): string {
    return this.getData().hubId;
  }
};
