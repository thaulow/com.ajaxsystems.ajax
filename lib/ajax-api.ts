'use strict';

import https from 'https';
import http from 'http';
import {
  AuthCredentials,
  SessionState,
  LoginResponse,
  RefreshResponse,
  AjaxHub,
  AjaxDevice,
  AjaxGroup,
  AjaxRoom,
  ArmingCommand,
  ArmingCommandRequest,
  DeviceCommand,
  DeviceCommandRequest,
  AjaxApiError,
  AjaxAuthError,
  AjaxConnectionError,
} from './types';
import { hashPassword } from './util';

const API_BASE_URL = 'https://api.ajax.systems/api';
const SESSION_TOKEN_TTL_MS = 15 * 60 * 1000;    // 15 minutes
const SESSION_REFRESH_MARGIN_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RATE_LIMIT = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

export class AjaxApiClient {

  private credentials: AuthCredentials;
  private session: SessionState | null = null;
  private log: (...args: any[]) => void;
  private error: (...args: any[]) => void;

  // Rate limiting
  private requestTimestamps: number[] = [];

  // Refresh deduplication
  private refreshPromise: Promise<void> | null = null;

  constructor(credentials: AuthCredentials, log: (...args: any[]) => void, error: (...args: any[]) => void) {
    this.credentials = credentials;
    this.log = log;
    this.error = error;
  }

  // ============================================================
  // Session Management
  // ============================================================

  /**
   * Restore a previously saved session (e.g., from Homey settings).
   */
  setSession(session: SessionState): void {
    this.session = session;
  }

  /**
   * Get the current session for persistence.
   */
  getSession(): SessionState | null {
    return this.session;
  }

  /**
   * Get the SSE URL (proxy mode only).
   */
  getSseUrl(): string | undefined {
    return this.session?.sseUrl;
  }

  /**
   * Login to the Ajax API.
   */
  async login(): Promise<SessionState> {
    const { mode, email, password, userRole } = this.credentials;

    if (mode !== 'user' && mode !== 'proxy') {
      throw new AjaxAuthError('Login is only supported in user or proxy mode');
    }

    if (!email || !password) {
      throw new AjaxAuthError('Email and password are required for login');
    }

    const body = {
      login: email,
      passwordHash: hashPassword(password),
      userRole: userRole || 'USER',
    };

    const response = await this.rawRequest('POST', '/login', body, false);
    const data = response as LoginResponse;

    this.session = {
      sessionToken: data.sessionToken,
      refreshToken: data.refreshToken,
      userId: data.userId,
      tokenCreatedAt: Date.now(),
      sseUrl: data.sseUrl,
    };

    this.log('Logged in successfully, userId:', data.userId);
    return this.session;
  }

  /**
   * Refresh the session token.
   */
  async refreshSession(): Promise<void> {
    // Deduplicate concurrent refresh calls
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<void> {
    if (!this.session) {
      throw new AjaxAuthError('No session to refresh');
    }

    const body = {
      userId: this.session.userId,
      refreshToken: this.session.refreshToken,
    };

    try {
      const data = await this.rawRequest('POST', '/refresh', body, false) as RefreshResponse;
      this.session = {
        sessionToken: data.sessionToken,
        refreshToken: data.refreshToken,
        userId: data.userId,
        tokenCreatedAt: Date.now(),
        sseUrl: this.session.sseUrl,
      };
      this.log('Session refreshed successfully');
    } catch (err) {
      this.session = null;
      throw new AjaxAuthError(`Session refresh failed: ${(err as Error).message}`);
    }
  }

  /**
   * Ensure we have a valid token before making requests.
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.session) {
      await this.login();
      return;
    }

    const elapsed = Date.now() - this.session.tokenCreatedAt;
    if (elapsed >= SESSION_TOKEN_TTL_MS - SESSION_REFRESH_MARGIN_MS) {
      await this.refreshSession();
    }
  }

  // ============================================================
  // Core Request Method
  // ============================================================

  private getBaseUrl(): string {
    if (this.credentials.mode === 'proxy' && this.credentials.proxyUrl) {
      return `${this.credentials.proxyUrl.replace(/\/$/, '')}/api`;
    }
    return API_BASE_URL;
  }

  private getBasePath(): string {
    return `/user/${this.session?.userId}`;
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.credentials.apiKey) {
      headers['X-Api-Key'] = this.credentials.apiKey;
    }

    if (this.session?.sessionToken) {
      headers['X-Session-Token'] = this.session.sessionToken;
    }

    return headers;
  }

  /**
   * Enforce client-side rate limiting.
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

    if (this.requestTimestamps.length >= MAX_RATE_LIMIT) {
      const oldestInWindow = this.requestTimestamps[0];
      const waitMs = RATE_LIMIT_WINDOW_MS - (now - oldestInWindow) + 100;
      this.log(`Rate limit reached, waiting ${waitMs}ms`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    this.requestTimestamps.push(Date.now());
  }

  /**
   * Make a raw HTTP request using native Node.js https module.
   */
  private async rawRequest(
    method: string,
    endpoint: string,
    body?: any,
    authenticated: boolean = true,
    noCacheBypass: boolean = false,
  ): Promise<any> {
    await this.enforceRateLimit();

    const fullUrl = `${this.getBaseUrl()}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (authenticated) {
      Object.assign(headers, this.getAuthHeaders());
    }

    if (noCacheBypass && this.credentials.mode === 'proxy') {
      headers['X-Cache-Control'] = 'no-cache';
    }

    const bodyStr = (body && method !== 'GET') ? JSON.stringify(body) : null;
    if (bodyStr) {
      headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }

    const parsedUrl = new URL(fullUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    return new Promise<any>((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers,
        timeout: REQUEST_TIMEOUT_MS,
        rejectUnauthorized: this.credentials.verifySsl !== false,
      };

      const req = transport.request(options, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          const statusCode = res.statusCode || 0;

          if (statusCode === 204) {
            resolve(null);
            return;
          }

          let parsed: any;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = null;
          }

          if (statusCode >= 200 && statusCode < 300) {
            resolve(parsed);
            return;
          }

          if (statusCode === 401 || statusCode === 403) {
            reject(new AjaxAuthError(
              parsed?.message || `Authentication failed (${statusCode})`,
              statusCode,
              parsed,
            ));
            return;
          }

          reject(new AjaxApiError(
            parsed?.message || `API error (${statusCode})`,
            statusCode,
            parsed,
          ));
        });
      });

      req.on('error', (err: Error) => {
        reject(new AjaxConnectionError(`Connection failed: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new AjaxConnectionError('Request timed out'));
      });

      if (bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    });
  }

  /**
   * Make an authenticated API request with automatic token refresh on 401.
   */
  private async request(method: string, endpoint: string, body?: any, noCacheBypass: boolean = false): Promise<any> {
    await this.ensureValidToken();

    try {
      return await this.rawRequest(method, endpoint, body, true, noCacheBypass);
    } catch (err) {
      if (err instanceof AjaxAuthError && err.statusCode === 401) {
        // Try refreshing the token and retry once
        this.log('Got 401, attempting token refresh and retry');
        await this.refreshSession();
        return this.rawRequest(method, endpoint, body, true, noCacheBypass);
      }
      throw err;
    }
  }

  // ============================================================
  // Hub Endpoints
  // ============================================================

  /**
   * List all hubs for the authenticated user.
   */
  async getHubs(): Promise<AjaxHub[]> {
    const basePath = this.getBasePath();
    const data = await this.request('GET', `${basePath}/hubs`);
    return data as AjaxHub[];
  }

  /**
   * Get detailed information about a specific hub.
   */
  async getHub(hubId: string): Promise<AjaxHub> {
    const basePath = this.getBasePath();
    return await this.request('GET', `${basePath}/hubs/${hubId}`) as AjaxHub;
  }

  /**
   * Arm or disarm a hub.
   */
  async setHubArming(hubId: string, command: ArmingCommand, ignoreProblems: boolean = false): Promise<any> {
    const basePath = this.getBasePath();
    const body: ArmingCommandRequest = { command, ignoreProblems };
    return this.request('PUT', `${basePath}/hubs/${hubId}/commands/arming`, body);
  }

  /**
   * Send panic alert on a hub.
   */
  async sendPanic(hubId: string): Promise<void> {
    const basePath = this.getBasePath();
    await this.request('PUT', `${basePath}/hubs/${hubId}/commands/panic`);
  }

  /**
   * Mute fire detectors on a hub.
   */
  async muteFireDetectors(hubId: string): Promise<void> {
    const basePath = this.getBasePath();
    await this.request('PUT', `${basePath}/hubs/${hubId}/commands/muteFireDetectors`);
  }

  // ============================================================
  // Device Endpoints
  // ============================================================

  /**
   * List all devices on a hub with enriched data.
   */
  async getDevices(hubId: string): Promise<AjaxDevice[]> {
    const basePath = this.getBasePath();
    const data = await this.request('GET', `${basePath}/hubs/${hubId}/devices?enrich=true`);
    return data as AjaxDevice[];
  }

  /**
   * Get detailed information about a specific device.
   */
  async getDevice(hubId: string, deviceId: string): Promise<AjaxDevice> {
    const basePath = this.getBasePath();
    return await this.request('GET', `${basePath}/hubs/${hubId}/devices/${deviceId}`) as AjaxDevice;
  }

  /**
   * Send a command to a device (e.g., switch on/off).
   */
  async sendDeviceCommand(hubId: string, deviceId: string, command: DeviceCommand, deviceType: string): Promise<any> {
    const basePath = this.getBasePath();
    const body: DeviceCommandRequest = { command, deviceType };
    return this.request('POST', `${basePath}/hubs/${hubId}/devices/${deviceId}/command`, body);
  }

  /**
   * Update device settings.
   */
  async updateDevice(hubId: string, deviceId: string, settings: Record<string, any>): Promise<any> {
    const basePath = this.getBasePath();
    return this.request('PUT', `${basePath}/hubs/${hubId}/devices/${deviceId}`, settings);
  }

  // ============================================================
  // Group Endpoints
  // ============================================================

  /**
   * List all security groups on a hub.
   */
  async getGroups(hubId: string): Promise<AjaxGroup[]> {
    const basePath = this.getBasePath();
    const data = await this.request('GET', `${basePath}/hubs/${hubId}/groups`);
    return data as AjaxGroup[];
  }

  /**
   * Get a specific group.
   */
  async getGroup(hubId: string, groupId: string): Promise<AjaxGroup> {
    const basePath = this.getBasePath();
    return await this.request('GET', `${basePath}/hubs/${hubId}/groups/${groupId}`) as AjaxGroup;
  }

  /**
   * Arm or disarm a specific group.
   */
  async setGroupArming(hubId: string, groupId: string, command: ArmingCommand, ignoreProblems: boolean = false): Promise<any> {
    const basePath = this.getBasePath();
    const body: ArmingCommandRequest = { command, ignoreProblems };
    return this.request('PUT', `${basePath}/hubs/${hubId}/groups/${groupId}/commands/arming`, body);
  }

  // ============================================================
  // Room Endpoints
  // ============================================================

  /**
   * List all rooms on a hub.
   */
  async getRooms(hubId: string): Promise<AjaxRoom[]> {
    const basePath = this.getBasePath();
    const data = await this.request('GET', `${basePath}/hubs/${hubId}/rooms`);
    return data as AjaxRoom[];
  }

  // ============================================================
  // Log Endpoints
  // ============================================================

  /**
   * Get event logs for a hub.
   */
  async getLogs(hubId: string, page: number = 1): Promise<any[]> {
    const basePath = this.getBasePath();
    return await this.request('GET', `${basePath}/hubs/${hubId}/logs?page=${page}`) as any[];
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Perform a no-cache request (after receiving a real-time event).
   */
  async getHubFresh(hubId: string): Promise<AjaxHub> {
    const basePath = this.getBasePath();
    return await this.request('GET', `${basePath}/hubs/${hubId}`, undefined, true) as AjaxHub;
  }

  async getDevicesFresh(hubId: string): Promise<AjaxDevice[]> {
    const basePath = this.getBasePath();
    return await this.request('GET', `${basePath}/hubs/${hubId}/devices?enrich=true`, undefined, true) as AjaxDevice[];
  }

  /**
   * Test the connection by fetching hubs.
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getHubs();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Destroy the client (cleanup).
   */
  destroy(): void {
    this.session = null;
    this.requestTimestamps = [];
    this.refreshPromise = null;
  }
}
