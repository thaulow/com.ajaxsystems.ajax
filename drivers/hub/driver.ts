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
    this.homey.flow.getActionCard('arm_hub')
      .registerRunListener(async (args) => {
        const device = args.device;
        await device.triggerCapabilityListener('homealarm_state', 'armed');
      });

    this.homey.flow.getActionCard('disarm_hub')
      .registerRunListener(async (args) => {
        const device = args.device;
        await device.triggerCapabilityListener('homealarm_state', 'disarmed');
      });

    this.homey.flow.getActionCard('night_mode_on')
      .registerRunListener(async (args) => {
        const device = args.device;
        await device.triggerCapabilityListener('ajax_night_mode', true);
      });

    this.homey.flow.getActionCard('night_mode_off')
      .registerRunListener(async (args) => {
        const device = args.device;
        await device.triggerCapabilityListener('ajax_night_mode', false);
      });

    this.homey.flow.getActionCard('mute_fire_detectors')
      .registerRunListener(async (args) => {
        const app = this.homey.app as any;
        if (!app?.isReady()) throw new Error('App not ready');
        const hubId = args.device.getData().hubId;
        await app.getApi().muteFireDetectors(hubId);
      });
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    let api: AjaxApiClient | null = null;

    session.setHandler('login', async (data: { username: string; password: string }) => {
      this.log('Pairing: login attempt for', data.username);

      const apiKey = this.homey.settings.get('api_key') as string;
      const mode = (this.homey.settings.get('auth_mode') as string) || 'user';

      if (!apiKey && mode !== 'proxy') {
        throw new Error('Please configure your API key in the app settings first');
      }

      const credentials: AuthCredentials = {
        mode: mode as AuthCredentials['mode'],
        apiKey: apiKey || '',
        email: data.username,
        password: data.password,
        userRole: (this.homey.settings.get('user_role') as string || 'USER') as AuthCredentials['userRole'],
      };

      if (mode === 'proxy') {
        credentials.proxyUrl = this.homey.settings.get('proxy_url') as string;
      }

      api = new AjaxApiClient(
        credentials,
        this.log.bind(this),
        this.error.bind(this),
      );

      const session_state = await api.login();

      // Save credentials to app settings for the main app to use
      this.homey.settings.set('email', data.username);
      this.homey.settings.set('password', data.password);
      this.homey.settings.set('session', session_state);

      return true;
    });

    session.setHandler('list_devices', async () => {
      if (!api) {
        // Try using the existing app API
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
        },
        capabilities: [
          'homealarm_state',
          'ajax_night_mode',
          'alarm_tamper',
          'measure_battery',
          'ajax_gsm_signal',
          'ajax_wifi_signal',
          'ajax_connection_state',
          'ajax_firmware_version',
        ],
      }));
    });
  }

};
