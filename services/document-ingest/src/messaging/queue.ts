import amqp from 'amqplib';
import { randomUUID } from 'crypto';
import { createLogger } from '@ai-accountant/shared-utils';
import { ProcessingQueues, ProcessingQueueConfig } from '@ai-accountant/shared-types';
import { recordQueueEvent } from '@ai-accountant/monitoring-service/services/queueMetrics';

const logger = createLogger('document-ingest-service');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
const DEFAULT_RETRY_DELAY_MS = parseInt(process.env.QUEUE_RETRY_DELAY_MS || '15000', 10);

const OCR_QUEUE = ProcessingQueues.OCR.primary;
const CLASSIFICATION_QUEUE = ProcessingQueues.CLASSIFICATION.primary;
const LEDGER_QUEUE = ProcessingQueues.LEDGER.primary;

const QUEUE_BINDINGS: ProcessingQueueConfig[] = Object.values(ProcessingQueues);
type JobPayload = Record<string, unknown> & { documentId?: string };

let connection: amqp.ChannelModel | null = null;
let channel: amqp.Channel | null = null;
let connectingPromise: Promise<void> | null = null;

export interface PublishMetadata {
  traceId?: string;
  tenantId?: string;
  source?: string;
  correlationId?: string;
  headers?: Record<string, unknown>;
}

async function assertProcessingQueue(
  ch: amqp.Channel,
  config: ProcessingQueueConfig,
  retryDelayMs: number
): Promise<void> {
  await ch.assertQueue(config.dlq, { durable: true });
  await ch.assertQueue(config.primary, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': config.dlq,
    },
  });
  await ch.assertQueue(config.retry, {
    durable: true,
    arguments: {
      'x-message-ttl': retryDelayMs,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': config.primary,
    },
  });
}

export async function connectQueue(): Promise<void> {
  if (channel && connection) {
    return;
  }

  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = (async () => {
    try {
      const conn = await amqp.connect(RABBITMQ_URL);
      connection = conn;
      const ch = await conn.createChannel();
      channel = ch;

      await Promise.all(
        QUEUE_BINDINGS.map((binding) => assertProcessingQueue(ch, binding, DEFAULT_RETRY_DELAY_MS))
      );

      conn.on('close', (err) => {
        logger.error('RabbitMQ connection closed', err instanceof Error ? err : new Error(String(err)));
        connection = null;
        channel = null;
      });

      conn.on('error', (err) => {
        logger.error('RabbitMQ connection error', err instanceof Error ? err : new Error(String(err)));
      });

      logger.info('Connected to message queue');
    } catch (error) {
      logger.error('Failed to connect to message queue', error instanceof Error ? error : new Error(String(error)));
      connection = null;
      channel = null;
      throw error;
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
}

async function getChannel(): Promise<amqp.Channel> {
  if (!channel) {
    await connectQueue();
  }

  if (!channel) {
    throw new Error('Message queue not connected');
  }

  return channel;
}

function buildPublishOptions(metadata?: PublishMetadata): amqp.Options.Publish {
  const traceId = metadata?.traceId || randomUUID();
  const messageId = randomUUID();
  const headers: Record<string, unknown> = {
    'x-trace-id': traceId,
    'x-source-service': metadata?.source || 'document-ingest-service',
    'x-attempts': metadata?.headers?.['x-attempts'] ?? 0,
    'x-enqueued-at': new Date().toISOString(),
    ...metadata?.headers,
  };

  if (metadata?.tenantId) {
    headers['x-tenant-id'] = metadata.tenantId;
  }

  return {
    persistent: true,
    messageId,
    correlationId: metadata?.correlationId || traceId,
    headers,
  };
}

async function publishJob(queue: string, payload: JobPayload, metadata?: PublishMetadata): Promise<void> {
  const ch = await getChannel();
  const options = buildPublishOptions(metadata);
  const body = JSON.stringify(payload);
  ch.sendToQueue(queue, Buffer.from(body), options);
  logger.info('Job published', {
    queue,
    messageId: options.messageId,
    documentId: payload.documentId,
  });

  recordQueueEvent({
    serviceName: 'document-ingest-service',
    queueName: queue,
    eventType: 'enqueue',
    metadata: {
      documentId: payload.documentId,
      source: metadata?.source,
    },
  });
}

export async function publishOCRJob(
  documentId: string,
  storageKey: string,
  metadata?: PublishMetadata
): Promise<void> {
  try {
    await publishJob(
      OCR_QUEUE,
      { documentId, storageKey },
      { source: 'document-ingest.ocr', ...metadata }
    );
  } catch (error) {
    logger.error('Failed to publish OCR job', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function publishClassificationJob(
  documentId: string,
  extractedText: string,
  metadata?: PublishMetadata
): Promise<void> {
  try {
    await publishJob(
      CLASSIFICATION_QUEUE,
      { documentId, extractedText },
      { source: 'document-ingest.classification', ...metadata }
    );
    logger.info('Classification job published', { documentId });
  } catch (error) {
    logger.error('Failed to publish classification job', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function publishLedgerJob(
  documentId: string,
  metadata?: Record<string, unknown>,
  queueMetadata?: PublishMetadata
): Promise<void> {
  try {
    await publishJob(
      LEDGER_QUEUE,
      {
        documentId,
        metadata,
      },
      { source: 'document-ingest.ledger', ...queueMetadata }
    );
    logger.info('Ledger posting job published', { documentId });
  } catch (error) {
    logger.error('Failed to publish ledger posting job', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function closeQueue(): Promise<void> {
  try {
    if (channel) {
      await channel.close();
      channel = null;
    }
    if (connection) {
      await connection.close();
      connection = null;
    }
  } catch (error) {
    logger.error('Error closing queue connection', error instanceof Error ? error : new Error(String(error)));
  }
}
