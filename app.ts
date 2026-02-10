'use strict';

import Homey from 'homey';
import { AjaxApiClient } from './lib/ajax-api';
import { AjaxCoordinator } from './lib/ajax-coordinator';
import { AjaxSqsClient } from './lib/sqs-client';
import { AjaxSseClient } from './lib/sse-client';
import { AjaxEventHandler } from './lib/event-handler';
import { AuthCredentials, SessionState, SqsConfig, PollingConfig } from './lib/types';

module.exports = class AjaxApp extends Homey.App {

  private api!: AjaxApiClient;
  private coordinator!: AjaxCoordinator;
  private sqsClient: AjaxSqsClient | null = null;
  private sseClient: AjaxSseClient | null = null;
  private eventHandler!: AjaxEventHandler;

  async onInit(): Promise<void> {
    this.log('Ajax Systems app initializing...');

    // Try to initialize if credentials are available
    const credentials = this.getCredentials();
    if (credentials) {
      await this.initializeClients(credentials);
    } else {
      this.log('No credentials configured yet. Waiting for settings.');
    }

    // Listen for settings changes
    this.homey.settings.on('set', (key: string) => {
      if (['auth_mode', 'api_key', 'email', 'password', 'company_id',
           'company_token', 'proxy_url', 'sqs_enabled',
           'poll_armed', 'poll_disarmed'].includes(key)) {
        this.log(`Setting "${key}" changed, reinitializing...`);
        this.reinitialize().catch(err => this.error('Reinitialize failed:', err));
      }
    });

    this.log('Ajax Systems app initialized');
  }

  async onUninit(): Promise<void> {
    this.log('Ajax Systems app shutting down...');
    this.destroyClients();
  }

  // ============================================================
  // Public API for Drivers
  // ============================================================

  getApi(): AjaxApiClient {
    return this.api;
  }

  getCoordinator(): AjaxCoordinator {
    return this.coordinator;
  }

  isReady(): boolean {
    return !!this.api && !!this.coordinator;
  }

  // ============================================================
  // Initialization
  // ============================================================

  private getCredentials(): AuthCredentials | null {
    const mode = this.homey.settings.get('auth_mode') as string;
    const apiKey = this.homey.settings.get('api_key') as string;

    if (!mode || !apiKey) return null;

    const credentials: AuthCredentials = {
      mode: mode as AuthCredentials['mode'],
      apiKey,
    };

    switch (mode) {
      case 'user':
        credentials.email = this.homey.settings.get('email') as string;
        credentials.password = this.homey.settings.get('password') as string;
        credentials.userRole = (this.homey.settings.get('user_role') as string || 'USER') as AuthCredentials['userRole'];
        if (!credentials.email || !credentials.password) return null;
        break;
      case 'company':
        credentials.companyId = this.homey.settings.get('company_id') as string;
        credentials.companyToken = this.homey.settings.get('company_token') as string;
        if (!credentials.companyId || !credentials.companyToken) return null;
        break;
      case 'proxy':
        credentials.email = this.homey.settings.get('email') as string;
        credentials.password = this.homey.settings.get('password') as string;
        credentials.proxyUrl = this.homey.settings.get('proxy_url') as string;
        credentials.verifySsl = this.homey.settings.get('verify_ssl') !== false;
        if (!credentials.email || !credentials.password || !credentials.proxyUrl) return null;
        break;
      default:
        return null;
    }

    return credentials;
  }

  private getSqsConfig(): SqsConfig | null {
    const enabled = this.homey.settings.get('sqs_enabled');
    if (!enabled) return null;

    const awsAccessKeyId = this.homey.settings.get('sqs_access_key') as string;
    const awsSecretAccessKey = this.homey.settings.get('sqs_secret_key') as string;
    const eventsQueueName = this.homey.settings.get('sqs_events_queue') as string;
    const updatesQueueName = this.homey.settings.get('sqs_updates_queue') as string;

    if (!awsAccessKeyId || !awsSecretAccessKey || !eventsQueueName) return null;

    return {
      awsAccessKeyId,
      awsSecretAccessKey,
      eventsQueueName,
      updatesQueueName: updatesQueueName || '',
      region: this.homey.settings.get('sqs_region') as string || 'eu-west-1',
    };
  }

  private getPollingConfig(): Partial<PollingConfig> {
    return {
      armedIntervalSeconds: Number(this.homey.settings.get('poll_armed')) || 10,
      disarmedIntervalSeconds: Number(this.homey.settings.get('poll_disarmed')) || 30,
    };
  }

  async initializeClients(credentials: AuthCredentials): Promise<void> {
    this.destroyClients();

    // Create API client
    this.api = new AjaxApiClient(
      credentials,
      this.log.bind(this),
      this.error.bind(this),
    );

    // Restore session if available
    const savedSession = this.homey.settings.get('session') as SessionState | null;
    if (savedSession) {
      this.api.setSession(savedSession);
    }

    // Login or verify session
    try {
      if (credentials.mode !== 'company') {
        const session = await this.api.login();
        this.homey.settings.set('session', session);
      }
    } catch (err) {
      this.error('Login failed:', (err as Error).message);
      // Don't throw - coordinator will handle auth errors
    }

    // Create event handler
    this.eventHandler = new AjaxEventHandler(this.log.bind(this), this.error.bind(this));

    // Create coordinator
    this.coordinator = new AjaxCoordinator(
      this.api,
      this.homey,
      this.getPollingConfig(),
      this.log.bind(this),
      this.error.bind(this),
    );

    // Save session on updates
    this.coordinator.on('dataUpdated', () => {
      const session = this.api.getSession();
      if (session) {
        this.homey.settings.set('session', session);
      }
    });

    this.coordinator.on('authError', () => {
      this.error('Authentication error - credentials may need updating');
    });

    // Start coordinator
    this.coordinator.start();

    // Start SQS if configured
    const sqsConfig = this.getSqsConfig();
    if (sqsConfig && credentials.mode !== 'proxy') {
      this.startSqsClient(sqsConfig);
    }

    // Start SSE if in proxy mode
    if (credentials.mode === 'proxy') {
      this.startSseClient();
    }

    this.log('All clients initialized');
  }

  private startSqsClient(config: SqsConfig): void {
    try {
      this.sqsClient = new AjaxSqsClient(config, this.log.bind(this), this.error.bind(this));
      this.sqsClient.on('event', (event) => {
        this.eventHandler.handleEvent(event, this.coordinator);
      });
      this.sqsClient.on('update', (update) => {
        this.eventHandler.handleUpdate(update, this.coordinator);
      });
      this.sqsClient.start();
      this.log('SQS client started');
    } catch (err) {
      this.error('Failed to start SQS client:', (err as Error).message);
    }
  }

  private startSseClient(): void {
    const sseUrl = this.api.getSseUrl();
    if (!sseUrl) {
      this.log('No SSE URL available from proxy login');
      return;
    }

    try {
      const session = this.api.getSession();
      this.sseClient = new AjaxSseClient(
        sseUrl,
        session?.sessionToken || '',
        this.log.bind(this),
        this.error.bind(this),
      );
      this.sseClient.on('event', (event) => {
        this.eventHandler.handleEvent(event, this.coordinator);
      });
      this.sseClient.start();
      this.log('SSE client started');
    } catch (err) {
      this.error('Failed to start SSE client:', (err as Error).message);
    }
  }

  private async reinitialize(): Promise<void> {
    const credentials = this.getCredentials();
    if (credentials) {
      await this.initializeClients(credentials);
    } else {
      this.destroyClients();
      this.log('Credentials incomplete, clients destroyed');
    }
  }

  private destroyClients(): void {
    if (this.coordinator) {
      this.coordinator.stop();
      this.coordinator.removeAllListeners();
    }
    if (this.sqsClient) {
      this.sqsClient.stop();
      this.sqsClient.removeAllListeners();
      this.sqsClient = null;
    }
    if (this.sseClient) {
      this.sseClient.stop();
      this.sseClient.removeAllListeners();
      this.sseClient = null;
    }
    if (this.api) {
      this.api.destroy();
    }
  }

};
