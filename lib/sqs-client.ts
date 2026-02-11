'use strict';

import { EventEmitter } from 'events';
import { SqsConfig } from './types';

/**
 * AWS SQS client for receiving real-time events from Ajax Systems.
 *
 * Uses the @aws-sdk/client-sqs package for long-polling two FIFO queues:
 * - Events queue: alarms, arm/disarm, malfunctions
 * - Updates queue: device state changes
 */
export class AjaxSqsClient extends EventEmitter {

  private config: SqsConfig;
  private log: (...args: any[]) => void;
  private error: (...args: any[]) => void;
  private running: boolean = false;
  private consecutiveErrors: number = 0;
  private maxConsecutiveErrors: number = 5;

  // SQS client instances (lazy-loaded)
  private sqsClient: any = null;
  private eventsQueueUrl: string = '';
  private updatesQueueUrl: string = '';

  constructor(config: SqsConfig, log: (...args: any[]) => void, error: (...args: any[]) => void) {
    super();
    this.config = config;
    this.log = log;
    this.error = error;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.consecutiveErrors = 0;

    try {
      // Dynamically require AWS SDK (optional dependency, installed at runtime)
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, GetQueueUrlCommand } = require('@aws-sdk/client-sqs');

      this.sqsClient = new SQSClient({
        region: this.config.region || 'eu-west-1',
        credentials: {
          accessKeyId: this.config.awsAccessKeyId,
          secretAccessKey: this.config.awsSecretAccessKey,
        },
      });

      // Resolve queue URLs from names
      const eventsResult = await this.sqsClient.send(new GetQueueUrlCommand({
        QueueName: this.config.eventsQueueName,
      }));
      this.eventsQueueUrl = eventsResult.QueueUrl || '';

      if (this.config.updatesQueueName) {
        const updatesResult = await this.sqsClient.send(new GetQueueUrlCommand({
          QueueName: this.config.updatesQueueName,
        }));
        this.updatesQueueUrl = updatesResult.QueueUrl || '';
      }

      this.log('SQS queues resolved, starting poll loops');

      // Start polling both queues
      this.pollEventsQueue();
      if (this.updatesQueueUrl) {
        this.pollUpdatesQueue();
      }

    } catch (err) {
      this.error('Failed to initialize SQS client:', (err as Error).message);
      this.running = false;
    }
  }

  stop(): void {
    this.running = false;
    this.sqsClient = null;
    this.log('SQS client stopped');
  }

  private async pollEventsQueue(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');

    while (this.running && this.sqsClient) {
      try {
        const result = await this.sqsClient.send(new ReceiveMessageCommand({
          QueueUrl: this.eventsQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 5,
          VisibilityTimeout: 30,
        }));

        const messages = result.Messages || [];
        for (const message of messages) {
          try {
            const body = JSON.parse(message.Body || '{}');
            this.emit('event', body);
          } catch (parseErr) {
            this.error('Failed to parse SQS event message:', (parseErr as Error).message);
          }

          // Delete message after processing
          try {
            await this.sqsClient.send(new DeleteMessageCommand({
              QueueUrl: this.eventsQueueUrl,
              ReceiptHandle: message.ReceiptHandle,
            }));
          } catch (deleteErr) {
            this.error('Failed to delete SQS message:', (deleteErr as Error).message);
          }
        }

        this.consecutiveErrors = 0;

        // Immediate re-poll if messages were received
        if (messages.length === 0) {
          await this.sleep(100);
        }

      } catch (err) {
        this.consecutiveErrors++;
        this.error(`SQS events poll error (${this.consecutiveErrors}):`, (err as Error).message);

        if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
          this.error('Too many SQS errors, backing off for 60s before retrying');
          await this.sleep(60_000);
          this.consecutiveErrors = 0;
          continue;
        }

        // Exponential backoff
        const backoff = Math.min(1000 * Math.pow(2, this.consecutiveErrors), 30_000);
        await this.sleep(backoff);
      }
    }
  }

  private async pollUpdatesQueue(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');

    while (this.running && this.sqsClient) {
      try {
        const result = await this.sqsClient.send(new ReceiveMessageCommand({
          QueueUrl: this.updatesQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 5,
          VisibilityTimeout: 30,
        }));

        const messages = result.Messages || [];
        for (const message of messages) {
          try {
            const body = JSON.parse(message.Body || '{}');
            this.emit('update', body);
          } catch (parseErr) {
            this.error('Failed to parse SQS update message:', (parseErr as Error).message);
          }

          try {
            await this.sqsClient.send(new DeleteMessageCommand({
              QueueUrl: this.updatesQueueUrl,
              ReceiptHandle: message.ReceiptHandle,
            }));
          } catch (deleteErr) {
            this.error('Failed to delete SQS update message:', (deleteErr as Error).message);
          }
        }

        if (messages.length === 0) {
          await this.sleep(100);
        }

      } catch (err) {
        this.error('SQS updates poll error:', (err as Error).message);
        await this.sleep(5000);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
