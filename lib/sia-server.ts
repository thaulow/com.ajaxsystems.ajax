'use strict';

import { EventEmitter } from 'events';
import * as net from 'net';
import { createDecipheriv } from 'crypto';
import {
  parseSiaMessage,
  buildSiaAck,
  SiaMessage,
  isNightArmEvent,
  isAlarmEvent,
  isTamperAlarm,
  isTroubleEvent,
  isTestEvent,
} from './sia-parser';

// ============================================================
// Types
// ============================================================

export interface SiaServerConfig {
  port: number;
  accountId: string;
  encryptionKey?: string; // AES-128 hex key (optional)
}

export interface SiaAlarmEvent {
  account: string;
  type: 'arm' | 'disarm' | 'night_arm' | 'night_disarm' | 'partial_arm' |
        'group_arm' | 'group_disarm' |
        'armed_with_faults' | 'arming_failed' |
        'alarm' | 'alarm_restore' | 'tamper' | 'tamper_restore' |
        'trouble' | 'trouble_restore' |
        'power_trouble' | 'power_restore' |
        'device_lost' | 'device_restore' |
        'bypass' | 'unbypass' |
        'test' | 'heartbeat' |
        'panic' | 'duress' | 'system' | 'unknown';
  /** More specific alarm category */
  category?: string;
  /** CID event code */
  code?: string;
  /** Human-readable description */
  description: string;
  /** Partition/group number (0 = whole system) */
  partition: number;
  /** Zone number (0 = system, >0 = specific sensor zone) */
  zone: number;
  /** Whether this is a restore event */
  isRestore: boolean;
  /** Timestamp */
  timestamp: Date;
  /** Raw SIA message */
  raw: string;
}

// ============================================================
// SIA Server
// ============================================================

/**
 * TCP server that listens for SIA DC-09 messages from Ajax hubs.
 *
 * Emits:
 * - 'event' (SiaAlarmEvent) - parsed alarm event
 * - 'heartbeat' (account: string) - periodic supervision signal
 * - 'connected' (address: string) - hub connected
 * - 'disconnected' (address: string) - hub disconnected
 * - 'error' (Error) - server error
 */
export class SiaServer extends EventEmitter {

  private config: SiaServerConfig;
  private server: net.Server | null = null;
  private sockets: Set<net.Socket> = new Set();
  private log: (...args: any[]) => void;
  private error: (...args: any[]) => void;
  private running: boolean = false;
  private lastHeartbeat: number = 0;

  constructor(
    config: SiaServerConfig,
    log: (...args: any[]) => void,
    error: (...args: any[]) => void,
  ) {
    super();
    this.config = config;
    this.log = log;
    this.error = error;
  }

  private static readonly BIND_RETRY_COUNT = 5;
  private static readonly BIND_RETRY_BASE_MS = 1000;

  /**
   * Start the SIA TCP server.
   * Retries on EADDRINUSE (previous process may not have released the port yet).
   */
  async start(): Promise<void> {
    if (this.running) return;

    for (let attempt = 1; attempt <= SiaServer.BIND_RETRY_COUNT; attempt++) {
      try {
        await this.tryBind();
        return; // Success
      } catch (err) {
        const errno = err as NodeJS.ErrnoException;
        if (errno.code === 'EADDRINUSE' && attempt < SiaServer.BIND_RETRY_COUNT) {
          const delay = SiaServer.BIND_RETRY_BASE_MS * attempt;
          this.log(`Port ${this.config.port} in use, retrying in ${delay}ms (attempt ${attempt}/${SiaServer.BIND_RETRY_COUNT})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }
  }

  private tryBind(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener('listening', onListening);
        server.close();
        reject(err);
      };

      const onListening = () => {
        server.removeListener('error', onError);
        // Re-attach a persistent error handler for runtime errors
        server.on('error', (err: NodeJS.ErrnoException) => {
          this.error('SIA server error:', err.message);
          this.emit('error', err);
        });
        this.server = server;
        this.running = true;
        this.log(`SIA server listening on port ${this.config.port}`);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.config.port, '0.0.0.0');
    });
  }

  /**
   * Stop the SIA server and release the port.
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.running = false;

      // Destroy all active sockets so the server can fully close
      for (const socket of this.sockets) {
        socket.destroy();
      }
      this.sockets.clear();

      if (this.server) {
        this.server.close(() => {
          this.server = null;
          this.log('SIA server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Whether the server is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Time since last heartbeat in milliseconds.
   */
  getTimeSinceLastHeartbeat(): number {
    if (this.lastHeartbeat === 0) return -1;
    return Date.now() - this.lastHeartbeat;
  }

  /**
   * Get the port the server is listening on.
   */
  getPort(): number {
    return this.config.port;
  }

  /**
   * Whether any hub has an active TCP connection to this server.
   */
  hasActiveConnections(): boolean {
    return this.sockets.size > 0;
  }

  // ============================================================
  // Connection Handling
  // ============================================================

  private handleConnection(socket: net.Socket): void {
    const address = `${socket.remoteAddress}:${socket.remotePort}`;
    this.log('SIA connection from:', address);
    this.emit('connected', address);

    // Disable Nagle's algorithm so ACK is sent immediately without buffering
    socket.setNoDelay(true);

    // Track socket for cleanup on server stop
    this.sockets.add(socket);

    let buffer = Buffer.alloc(0);

    socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      this.log('SIA raw data received:', data.toString('hex'), '|', data.toString('ascii').replace(/[\r\n]/g, '\\n'));

      // Process complete messages (terminated by CR = 0x0D)
      let crIndex: number;
      while ((crIndex = buffer.indexOf(0x0D)) !== -1) {
        const messageData = buffer.subarray(0, crIndex + 1);
        buffer = buffer.subarray(crIndex + 1);
        this.processMessage(messageData, socket);
      }

      // Safety: prevent buffer from growing too large
      if (buffer.length > 4096) {
        this.error('SIA buffer overflow, clearing');
        buffer = Buffer.alloc(0);
      }
    });

    socket.on('close', () => {
      this.sockets.delete(socket);
      // Process any remaining data in buffer (hub may close without trailing CR)
      if (buffer.length > 0) {
        this.log('SIA processing remaining buffer on close:', buffer.toString('hex'));
        this.processMessage(buffer, socket);
        buffer = Buffer.alloc(0);
      }
      this.log('SIA connection closed:', address);
      this.emit('disconnected', address);
    });

    socket.on('error', (err) => {
      this.error('SIA socket error:', err.message);
    });

    // Set a generous timeout (hubs send heartbeats every 30-180s typically)
    socket.setTimeout(300_000); // 5 minutes
    socket.on('timeout', () => {
      this.log('SIA socket timeout, closing:', address);
      socket.destroy();
    });
  }

  private processMessage(data: Buffer, socket: net.Socket): void {
    try {
      // Decrypt if encryption key is set
      let messageData = data;
      if (this.config.encryptionKey) {
        messageData = this.tryDecrypt(data);
      }

      const message = parseSiaMessage(messageData);
      if (!message) {
        this.log('SIA: could not parse message:', data.toString('ascii').trim());
        return;
      }

      this.log(`SIA parsed: proto=${message.protocol} seq=${message.sequence} acct=${message.account} recv=${message.receiver} line=${message.linePrefix} crc=${message.crcValid ? 'OK' : 'FAIL'}`);

      // Always send ACK first - the hub needs acknowledgement regardless of
      // whether we process the event. Without ACK, Ajax marks connection as failed.
      const ack = buildSiaAck(message);
      this.log('SIA sending ACK:', ack.toString('ascii').replace(/[\r\n]/g, '\\n'), '| hex:', ack.toString('hex'));
      if (socket.writable) {
        socket.write(ack, (err) => {
          if (err) {
            this.error('SIA: ACK write failed:', err.message);
          }
        });
      } else {
        this.log('SIA: socket not writable, cannot send ACK');
      }

      // Check account match if configured (lenient: strip leading zeros for comparison)
      if (this.config.accountId && message.account) {
        const configAcct = this.config.accountId.replace(/^0+/, '') || '0';
        const msgAcct = message.account.replace(/^0+/, '') || '0';
        if (configAcct !== msgAcct) {
          this.log(`SIA: ignoring message for account ${message.account} (expected ${this.config.accountId})`);
          return;
        }
      }

      // Handle the message
      if (message.protocol === 'NULL') {
        this.lastHeartbeat = Date.now();
        this.emit('heartbeat', message.account || this.config.accountId);
        return;
      }

      // Convert to our event format
      const alarmEvent = this.siaToAlarmEvent(message);
      if (alarmEvent) {
        this.log(`SIA event: ${alarmEvent.type} - ${alarmEvent.description} (zone ${alarmEvent.zone}, partition ${alarmEvent.partition})`);
        this.lastHeartbeat = Date.now();
        this.emit('event', alarmEvent);
      }
    } catch (err) {
      this.error('SIA message processing error:', (err as Error).message);
    }
  }

  private tryDecrypt(data: Buffer): Buffer {
    if (!this.config.encryptionKey) return data;

    try {
      // SIA DC-09 uses AES-128-CBC with the key as both key and IV.
      // Ajax supports "up to 32 HEX or 16 ASCII characters":
      //   - 32 hex chars → 16 bytes (AES-128 key)
      //   - 16 ASCII chars → 16 bytes (AES-128 key)
      const rawKey = this.config.encryptionKey;
      let keyBuf: Buffer;
      if (/^[0-9a-fA-F]+$/.test(rawKey) && rawKey.length <= 32 && rawKey.length % 2 === 0) {
        // Valid hex string
        keyBuf = Buffer.from(rawKey, 'hex');
      } else {
        // Treat as ASCII
        keyBuf = Buffer.from(rawKey, 'ascii');
      }
      // Pad or truncate to exactly 16 bytes for AES-128
      const key = Buffer.alloc(16);
      keyBuf.copy(key, 0, 0, Math.min(keyBuf.length, 16));

      // Find the encrypted portion (between quotes, the data part after account)
      const str = data.toString('ascii');
      const bracketStart = str.indexOf('[');
      const bracketEnd = str.lastIndexOf(']');

      if (bracketStart === -1 || bracketEnd === -1) return data;

      const encryptedHex = str.substring(bracketStart + 1, bracketEnd);
      if (!encryptedHex || encryptedHex.length % 2 !== 0) return data;

      const encryptedBuf = Buffer.from(encryptedHex, 'hex');
      const iv = key; // SIA DC-09 typically uses key as IV
      const decipher = createDecipheriv('aes-128-cbc', key, iv);
      decipher.setAutoPadding(true);

      const decrypted = Buffer.concat([decipher.update(encryptedBuf), decipher.final()]);
      const decryptedStr = decrypted.toString('ascii').replace(/\x00+$/, ''); // Remove null padding

      // Replace the encrypted portion with decrypted
      const result = str.substring(0, bracketStart + 1) + decryptedStr + str.substring(bracketEnd);
      return Buffer.from(result, 'ascii');
    } catch {
      // If decryption fails, try parsing as plaintext
      return data;
    }
  }

  // ============================================================
  // Event Mapping
  // ============================================================

  private siaToAlarmEvent(message: SiaMessage): SiaAlarmEvent | null {
    const event = message.event;
    if (!event) {
      // Non-CID SIA-DCS message - emit as generic
      return {
        account: message.account || this.config.accountId,
        type: 'unknown',
        description: `SIA message: ${message.raw}`,
        partition: 0,
        zone: 0,
        isRestore: false,
        timestamp: message.timestamp || new Date(),
        raw: message.raw,
      };
    }

    const alarmEvent: SiaAlarmEvent = {
      account: message.account || this.config.accountId,
      type: 'unknown',
      code: event.code,
      category: event.category,
      description: event.description,
      partition: event.partition,
      zone: event.zone,
      isRestore: event.isRestore,
      timestamp: message.timestamp || new Date(),
      raw: message.raw,
    };

    // Determine event type based on category and code.
    // Order matters: more specific checks before general ones.

    // 1. Duress (highest priority)
    if (event.category === 'duress') {
      alarmEvent.type = 'duress';
    }
    // 2. Panic
    else if (event.category === 'panic') {
      alarmEvent.type = event.isRestore ? 'alarm_restore' : 'panic';
    }
    // 3. Bypass
    else if (event.category === 'bypass') {
      alarmEvent.type = event.isRestore ? 'unbypass' : 'bypass';
    }
    // 4. Arming - fine-grained routing
    else if (event.category === 'arming') {
      if (event.code === '455') {
        alarmEvent.type = 'arming_failed';
      } else if (event.code === '401' || event.code === '409') {
        alarmEvent.type = 'armed_with_faults';
      } else if (event.code === '402') {
        alarmEvent.type = event.qualifier === 1 ? 'group_arm' : 'group_disarm';
      } else if (isNightArmEvent(event.code)) {
        // Night arm code 441: check siaCode to distinguish NB/NF (armed with faults)
        const sc = event.siaCode;
        if (sc === 'NB' || sc === 'NF') {
          alarmEvent.type = 'armed_with_faults';
        } else {
          alarmEvent.type = event.qualifier === 1 ? 'night_arm' : 'night_disarm';
        }
      } else {
        alarmEvent.type = event.qualifier === 1 ? 'arm' : 'disarm';
      }
    }
    // 5. Communication - split device-level vs hub-level
    else if (event.category === 'communication') {
      if (event.code === '381') {
        alarmEvent.type = event.isRestore ? 'device_restore' : 'device_lost';
      } else {
        alarmEvent.type = event.isRestore ? 'trouble_restore' : 'trouble';
      }
    }
    // 6. Tamper
    else if (isTamperAlarm(event.code)) {
      alarmEvent.type = event.isRestore ? 'tamper_restore' : 'tamper';
    }
    // 7. Alarms (CID 100-199)
    else if (isAlarmEvent(event.code)) {
      alarmEvent.type = event.isRestore ? 'alarm_restore' : 'alarm';
    }
    // 8. Power/battery subset of trouble (CID 301, 302, 311, 337, 384)
    else if (['301', '302', '311', '337', '384'].includes(event.code)) {
      alarmEvent.type = event.isRestore ? 'power_restore' : 'power_trouble';
    }
    // 9. System events
    else if (event.category === 'system') {
      alarmEvent.type = 'system';
    }
    // 10. Remaining trouble (CID 300-399)
    else if (isTroubleEvent(event.code)) {
      alarmEvent.type = event.isRestore ? 'trouble_restore' : 'trouble';
    }
    // 11. Test (CID 600-699)
    else if (isTestEvent(event.code)) {
      alarmEvent.type = 'test';
    }

    return alarmEvent;
  }
}
