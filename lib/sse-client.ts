'use strict';

import { EventEmitter } from 'events';
import https from 'https';
import http from 'http';

const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;
const KEEPALIVE_TIMEOUT_MS = 120_000;

/**
 * SSE (Server-Sent Events) client for receiving real-time events from an Ajax proxy.
 *
 * Handles:
 * - Standard SSE format (event: type\ndata: json\n\n)
 * - Raw JSON lines (proxy format)
 * - Auto-reconnect with exponential backoff
 * - Keepalive monitoring
 */
export class AjaxSseClient extends EventEmitter {

  private sseUrl: string;
  private sessionToken: string;
  private log: (...args: any[]) => void;
  private error: (...args: any[]) => void;

  private running: boolean = false;
  private request: http.ClientRequest | null = null;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;

  constructor(
    sseUrl: string,
    sessionToken: string,
    log: (...args: any[]) => void,
    error: (...args: any[]) => void,
  ) {
    super();
    this.sseUrl = sseUrl;
    this.sessionToken = sessionToken;
    this.log = log;
    this.error = error;
  }

  /**
   * Update the session token (e.g., after refresh) without reconnecting.
   */
  updateToken(token: string): void {
    this.sessionToken = token;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.reconnectAttempts = 0;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.cleanup();
  }

  private cleanup(): void {
    if (this.request) {
      this.request.destroy();
      this.request = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.keepaliveTimer) {
      clearTimeout(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private connect(): void {
    if (!this.running) return;

    this.cleanup();
    this.log('SSE connecting to:', this.sseUrl);

    const url = new URL(this.sseUrl);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'User-Agent': 'Ajax/3.26.0 (Android 14; SM-S928B)',
        'X-Client-Version': '0.12.0',
        'X-Session-Token': this.sessionToken,
      },
    };

    this.request = transport.request(options, (response) => {
      if (response.statusCode !== 200) {
        this.error('SSE connection failed with status:', response.statusCode);
        this.scheduleReconnect();
        return;
      }

      this.log('SSE connected');
      this.reconnectAttempts = 0;
      this.resetKeepalive();

      response.setEncoding('utf8');

      let buffer = '';
      let currentEvent = '';
      let currentData = '';

      response.on('data', (chunk: string) => {
        this.resetKeepalive();
        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();

          // Keepalive comment
          if (trimmed.startsWith(':')) continue;

          // Empty line = event dispatch
          if (trimmed === '') {
            if (currentData) {
              this.processEvent(currentEvent, currentData);
              currentEvent = '';
              currentData = '';
            }
            continue;
          }

          // SSE field parsing
          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
          } else if (trimmed.startsWith('data:')) {
            currentData += (currentData ? '\n' : '') + trimmed.slice(5).trim();
          } else if (trimmed.startsWith('{')) {
            // Raw JSON line (proxy format)
            this.processEvent('message', trimmed);
          }
        }
      });

      response.on('end', () => {
        this.log('SSE connection ended');
        this.scheduleReconnect();
      });

      response.on('error', (err: Error) => {
        this.error('SSE response error:', err.message);
        this.scheduleReconnect();
      });
    });

    this.request.on('error', (err: Error) => {
      this.error('SSE request error:', err.message);
      this.scheduleReconnect();
    });

    this.request.end();
  }

  private processEvent(eventType: string, data: string): void {
    try {
      const parsed = JSON.parse(data);
      this.emit('event', parsed);
    } catch {
      // Not JSON, ignore
    }
  }

  private resetKeepalive(): void {
    if (this.keepaliveTimer) {
      clearTimeout(this.keepaliveTimer);
    }
    this.keepaliveTimer = setTimeout(() => {
      this.log('SSE keepalive timeout, reconnecting');
      this.scheduleReconnect();
    }, KEEPALIVE_TIMEOUT_MS);
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    this.cleanup();

    this.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_MS,
    );

    this.log(`SSE reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
