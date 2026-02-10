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
  }

  private requireApiMode(device: any): void {
    if (device.getStoreValue('connectionMode') === 'sia') {
      throw new Error('This action is not available in SIA mode. SIA is receive-only — use the Ajax app or keypad to control your system.');
    }
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    let api: AjaxApiClient | null = null;
    this.siaLoginData = null;

    session.setHandler('login', async (data: any) => {
      this.log('Pairing: login attempt, mode:', data.auth_mode);

      const mode = data.auth_mode || 'user';

      // SIA mode: start server and return immediately.
      // The frontend will poll checkSiaConnection to wait for the hub.
      // (Homey's pairing framework has a 30s timeout on handler calls,
      // so we cannot block here waiting for the hub to connect.)
      if (mode === 'sia') {
        const port = parseInt(data.sia_port) || 5000;
        const accountId = (data.sia_account || '').trim();
        const hubName = (data.sia_hub_name || '').trim();

        if (!accountId) throw new Error('Account ID is required');
        if (!hubName) throw new Error('Hub name is required');
        if (port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535');

        const app = this.homey.app as any;
        if (!app?.startSiaServer) {
          throw new Error('App not ready');
        }

        try {
          await app.startSiaServer({
            port,
            accountId,
            encryptionKey: data.sia_encryption_key || undefined,
          });
        } catch (err) {
          throw new Error(`Failed to start SIA server on port ${port}: ${(err as Error).message}`);
        }

        const siaServer = app.getSiaServer();
        if (!siaServer) {
          throw new Error('SIA server failed to start');
        }

        this.log(`SIA server started on port ${port}, waiting for hub to connect...`);

        // Save SIA settings so the app reinitializes correctly
        this.homey.settings.set('auth_mode', 'sia');
        this.homey.settings.set('sia_port', port);
        this.homey.settings.set('sia_account', accountId);
        this.homey.settings.set('sia_encryption_key', data.sia_encryption_key || '');

        // Store for list_devices handler
        this.siaLoginData = {
          hubName: hubName,
          port,
          accountId,
          encryptionKey: data.sia_encryption_key || '',
          pingIntervalMinutes: parseInt(data.sia_ping_interval) || 0,
        };

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

    session.setHandler('checkSiaConnection', async () => {
      const app = this.homey.app as any;
      const siaServer = app?.getSiaServer?.();
      if (!siaServer) return { connected: false };

      // Check for active TCP connections (hub connected to our server)
      // or recent SIA messages (heartbeat/event processed successfully).
      const hasConnection = siaServer.hasActiveConnections();
      const timeSince = siaServer.getTimeSinceLastHeartbeat();
      const hasRecentActivity = timeSince >= 0 && timeSince < 300_000;
      const connected = hasConnection || hasRecentActivity;
      if (connected) {
        this.log('SIA pairing: hub connection confirmed (active TCP:', hasConnection, ', last activity:', timeSince, 'ms ago)');
      }
      return { connected };
    });

    session.setHandler('list_devices', async () => {
      // SIA mode: return a single hub with the user-provided name
      if (this.siaLoginData) {
        const { hubName, port, accountId, encryptionKey, pingIntervalMinutes } = this.siaLoginData;
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
            siaPingIntervalMinutes: pingIntervalMinutes,
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
            'ajax_connection_state',
            'ajax_last_event',
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
