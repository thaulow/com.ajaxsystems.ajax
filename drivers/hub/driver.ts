'use strict';

import Homey from 'homey';
import { AjaxApiClient } from '../../lib/ajax-api';
import { AuthCredentials } from '../../lib/types';

module.exports = class HubDriver extends Homey.Driver {

  private siaLoginData: any = null;

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
    this.siaLoginData = null;

    session.setHandler('login', async (data: any) => {
      this.log('Pairing: login attempt, mode:', data.auth_mode);

      const mode = data.auth_mode || 'user';

      // SIA mode: no API call needed, just validate and store config
      if (mode === 'sia') {
        const port = parseInt(data.sia_port) || 5000;
        const accountId = (data.sia_account || '').trim();
        const hubName = (data.sia_hub_name || '').trim();

        if (!accountId) throw new Error('Account ID is required');
        if (port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535');

        // Save SIA settings
        this.homey.settings.set('auth_mode', 'sia');
        this.homey.settings.set('sia_port', port);
        this.homey.settings.set('sia_account', accountId);
        this.homey.settings.set('sia_encryption_key', data.sia_encryption_key || '');

        // Store for list_devices handler
        this.siaLoginData = {
          hubName: hubName || `Ajax Hub (SIA)`,
          port,
          accountId,
          encryptionKey: data.sia_encryption_key || '',
        };

        // Tell the app to start/restart the SIA server
        const app = this.homey.app as any;
        if (app?.startSiaServer) {
          try {
            await app.startSiaServer({
              port,
              accountId,
              encryptionKey: data.sia_encryption_key || undefined,
            });
          } catch (err) {
            throw new Error(`Failed to start SIA server: ${(err as Error).message}`);
          }
        }

        return true;
      }

      // API-based modes
      const credentials: AuthCredentials = {
        mode: mode as AuthCredentials['mode'],
        apiKey: data.api_key || '',
      };

      switch (mode) {
        case 'user':
          credentials.email = data.email;
          credentials.password = data.password;
          credentials.userRole = (data.user_role || 'USER') as AuthCredentials['userRole'];
          if (!credentials.apiKey) throw new Error('API Key is required');
          if (!credentials.email) throw new Error('Email is required');
          if (!credentials.password) throw new Error('Password is required');
          break;
        case 'company':
          credentials.companyId = data.company_id;
          credentials.companyToken = data.company_token;
          if (!credentials.apiKey) throw new Error('API Key is required');
          if (!credentials.companyId) throw new Error('Company ID is required');
          if (!credentials.companyToken) throw new Error('Company Token is required');
          break;
        case 'proxy':
          credentials.email = data.email;
          credentials.password = data.password;
          credentials.proxyUrl = data.proxy_url;
          if (!credentials.email) throw new Error('Email is required');
          if (!credentials.password) throw new Error('Password is required');
          if (!credentials.proxyUrl) throw new Error('Proxy URL is required');
          break;
      }

      api = new AjaxApiClient(
        credentials,
        this.log.bind(this),
        this.error.bind(this),
      );

      if (mode !== 'company') {
        await api.login();
      }

      // Save all credentials to app settings so the main app can use them
      this.homey.settings.set('auth_mode', mode);
      this.homey.settings.set('api_key', data.api_key || '');
      if (mode === 'user') {
        this.homey.settings.set('email', data.email);
        this.homey.settings.set('password', data.password);
        this.homey.settings.set('user_role', data.user_role || 'USER');
      } else if (mode === 'company') {
        this.homey.settings.set('company_id', data.company_id);
        this.homey.settings.set('company_token', data.company_token);
      } else if (mode === 'proxy') {
        this.homey.settings.set('email', data.email);
        this.homey.settings.set('password', data.password);
        this.homey.settings.set('proxy_url', data.proxy_url);
      }

      const sessionState = api.getSession();
      if (sessionState) {
        this.homey.settings.set('session', sessionState);
      }

      return true;
    });

    session.setHandler('list_devices', async () => {
      // SIA mode: return a single hub with the user-provided name
      if (this.siaLoginData) {
        const { hubName, port, accountId, encryptionKey } = this.siaLoginData;
        const hubId = `sia_${accountId}_${port}`;
        return [{
          name: hubName,
          data: {
            id: hubId,
            hubId: hubId,
          },
          store: {
            connectionMode: 'sia',
            siaPort: port,
            siaAccountId: accountId,
            siaEncryptionKey: encryptionKey,
          },
          capabilities: [
            'homealarm_state',
            'ajax_night_mode',
            'alarm_tamper',
            'ajax_connection_state',
          ],
        }];
      }

      // API-based modes
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
          connectionMode: 'api',
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
