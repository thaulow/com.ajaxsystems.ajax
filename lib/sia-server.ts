'use strict';

import { EventEmitter } from 'events';
import * as net from 'net';
import { createDecipheriv } from 'crypto';
import {
  parseSiaMessage,
  buildSiaAck,
  SiaMessage,
  CidEvent,
  isArmEvent,
  isNightArmEvent,
  isPartialArmEvent,
  isAlarmEvent,
  isFireAlarm,
  isBurglaryAlarm,
  isWaterAlarm,
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
        'alarm' | 'alarm_restore' | 'tamper' | 'tamper_restore' |
        'trouble' | 'trouble_restore' | 'test' | 'heartbeat' | 'unknown';
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

  /**
   * Start the SIA TCP server.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.running) {
        resolve();
        return;
      }

      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        this.error('SIA server error:', err.message);
        if (err.code === 'EADDRINUSE') {
          this.error(`Port ${this.config.port} is already in use`);
        }
        this.emit('error', err);
        if (!this.running) {
          reject(err);
        }
      });

      this.server.listen(this.config.port, '0.0.0.0', () => {
        this.running = true;
        this.log(`SIA server listening on port ${this.config.port}`);
        resolve();
      });
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

  // ============================================================
  // Connection Handling
  // ============================================================

  private handleConnection(socket: net.Socket): void {
    const address = `${socket.remoteAddress}:${socket.remotePort}`;
    this.log('SIA connection from:', address);
    this.emit('connected', address);

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
        socket.write(ack);
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
      // SIA DC-09 uses AES-128-CBC with the key as both key and IV
      const keyBuf = Buffer.from(this.config.encryptionKey, 'hex');
      // Pad key to 16 bytes if needed
      const key = Buffer.alloc(16);
      keyBuf.copy(key);

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

    // Determine event type
    if (isArmEvent(event.code)) {
      // Qualifier 1 = closing (arming), 3 = opening (disarming)
      alarmEvent.type = event.qualifier === 1 ? 'arm' : 'disarm';
    } else if (isNightArmEvent(event.code)) {
      alarmEvent.type = event.qualifier === 1 ? 'night_arm' : 'night_disarm';
    } else if (isPartialArmEvent(event.code)) {
      alarmEvent.type = event.isRestore ? 'disarm' : 'partial_arm';
    } else if (isTamperAlarm(event.code)) {
      alarmEvent.type = event.isRestore ? 'tamper_restore' : 'tamper';
    } else if (isAlarmEvent(event.code)) {
      alarmEvent.type = event.isRestore ? 'alarm_restore' : 'alarm';
    } else if (isTroubleEvent(event.code)) {
      alarmEvent.type = event.isRestore ? 'trouble_restore' : 'trouble';
    } else if (isTestEvent(event.code)) {
      alarmEvent.type = 'test';
    }

    return alarmEvent;
  }
}
