'use strict';

import Homey from 'homey';
import { AjaxApiClient } from '../../lib/ajax-api';
import { AuthCredentials } from '../../lib/types';

module.exports = class HubDriver extends Homey.Driver {

  async onInit(): Promise<void> {
    this.log('Hub driver initialized');

    // Register flow condition cards
    this.homey.flow.getConditionCard('hub_is_armed')
      .registerRunListener(async (args) => {
        const device = args.device;
        return device.getCapabilityValue('homealarm_state') === 'armed';
      });

    this.homey.flow.getConditionCard('night_mode_on')
      .registerRunListener(async (args) => {
        const device = args.device;
        return device.getCapabilityValue('ajax_night_mode') === true;
      });

    // Register flow action cards
    // Note: These only work in API mode. SIA is receive-only (hub → Homey),
    // so commands cannot be sent back to the hub over SIA.
    this.homey.flow.getActionCard('arm_hub')
      .registerRunListener(async (args) => {
        this.requireApiMode(args.device);
        await args.device.triggerCapabilityListener('homealarm_state', 'armed');
      });

    this.homey.flow.getActionCard('disarm_hub')
      .registerRunListener(async (args) => {
        this.requireApiMode(args.device);
        await args.device.triggerCapabilityListener('homealarm_state', 'disarmed');
      });

    this.homey.flow.getActionCard('night_mode_on')
      .registerRunListener(async (args) => {
        this.requireApiMode(args.device);
        await args.device.triggerCapabilityListener('ajax_night_mode', true);
      });

    this.homey.flow.getActionCard('night_mode_off')
      .registerRunListener(async (args) => {
        this.requireApiMode(args.device);
        await args.device.triggerCapabilityListener('ajax_night_mode', false);
      });

    this.homey.flow.getActionCard('mute_fire_detectors')
      .registerRunListener(async (args) => {
        this.requireApiMode(args.device);
        const app = this.homey.app as any;
        if (!app?.isReady()) throw new Error('App not ready');
        const api = app.getApi();
        const hubId = args.device.getData().hubId;
        await api.muteFireDetectors(hubId);
      });

    this.homey.flow.getActionCard('send_panic_alert')
      .registerRunListener(async (args) => {
        this.requireApiMode(args.device);
        const app = this.homey.app as any;
        if (!app?.isReady()) throw new Error('App not ready');
        const api = app.getApi();
        const hubId = args.device.getData().hubId;
        await api.sendPanic(hubId);
      });

    // Register signal quality condition cards
    this.homey.flow.getConditionCard('gsm_signal_weak')
      .registerRunListener(async (args) => {
        const signal = args.device.getCapabilityValue('ajax_gsm_signal');
        return signal !== null && signal <= 25;
      });

    this.homey.flow.getConditionCard('wifi_signal_weak')
      .registerRunListener(async (args) => {
        const signal = args.device.getCapabilityValue('ajax_wifi_signal');
        return signal !== null && signal <= 25;
      });
  }

  private requireApiMode(device: any): void {
    const mode = device.getStoreValue('connectionMode');
    if (mode !== 'api' && mode !== 'both') {
      throw new Error('This action requires a proxy connection. Use the Ajax app or keypad to control your system.');
    }
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    let api: AjaxApiClient | null = null;

    session.setHandler('login', async (data: any) => {
      this.log('Pairing: login attempt');

      const email = (data.email || '').trim();
      const password = data.password || '';
      const proxyUrl = (data.proxy_url || '').trim();
      const port = parseInt(data.sia_port) || 5000;
      const accountId = (data.sia_account || '').trim();

      if (!email) throw new Error('Email is required');
      if (!password) throw new Error('Password is required');
      if (!proxyUrl) throw new Error('Proxy URL is required');
      if (!accountId) throw new Error('Account ID is required');
      if (port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535');

      // Login via proxy
      const credentials: AuthCredentials = {
        mode: 'proxy',
        apiKey: '',
        email,
        password,
        proxyUrl,
      };

      api = new AjaxApiClient(credentials, this.log.bind(this), this.error.bind(this));
      await api.login();

      // Save proxy credentials
      this.homey.settings.set('auth_mode', 'proxy');
      this.homey.settings.set('email', email);
      this.homey.settings.set('password', password);
      this.homey.settings.set('proxy_url', proxyUrl);
      const sessionState = api.getSession();
      if (sessionState) {
        this.homey.settings.set('session', sessionState);
      }

      // Start SIA server alongside proxy
      const app = this.homey.app as any;
      if (!app?.startSiaServer) throw new Error('App not ready');

      try {
        await app.startSiaServer({
          port,
          accountId,
          encryptionKey: data.sia_encryption_key || undefined,
        });
      } catch (err) {
        throw new Error(`Failed to start SIA server on port ${port}: ${(err as Error).message}`);
      }

      // Save SIA settings
      this.homey.settings.set('sia_enabled', true);
      this.homey.settings.set('sia_port', port);
      this.homey.settings.set('sia_account', accountId);
      this.homey.settings.set('sia_encryption_key', data.sia_encryption_key || '');
      this.homey.settings.set('sia_ping_interval', parseInt(data.sia_ping_interval) || 0);

      this.log(`Pairing complete: proxy connected, SIA server running on port ${port}`);
      return true;
    });

    session.setHandler('list_devices', async () => {
      if (!api) {
        const app = this.homey.app as any;
        if (app?.isReady()) {
          api = app.getApi();
        } else {
          throw new Error('Not logged in');
        }
      }

      const hubs = await api!.getHubs();
      return hubs.map(hub => ({
        name: hub.name || `Ajax Hub (${hub.hubSubtype})`,
        data: {
          id: hub.id,
          hubId: hub.id,
        },
        store: {
          hubSubtype: hub.hubSubtype,
          connectionMode: 'both',
        },
        capabilities: [
          'homealarm_state',
          'ajax_night_mode',
          'alarm_generic',
          'alarm_fire',
          'alarm_water',
          'alarm_co',
          'alarm_tamper',
          'alarm_battery',
          'ajax_ac_power',
          'ajax_device_lost',
          'ajax_rf_interference',
          'measure_battery',
          'ajax_gsm_signal',
          'ajax_wifi_signal',
          'ajax_connection_state',
          'ajax_firmware_version',
          'ajax_last_event',
        ],
      }));
    });
  }

};
