import amqp from 'amqplib';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';
import { createLogger } from '@ai-accountant/shared-utils';
import { processOCRJob } from './processor';
import { db } from '@ai-accountant/database';
import { DocumentStatus, ProcessingQueues } from '@ai-accountant/shared-types';
import { getFile } from './storage/s3';
import { recordQueueEvent } from '@ai-accountant/monitoring-service/services/queueMetrics';

config();

const logger = createLogger('ocr-service');
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
const MAX_RETRIES = parseInt(process.env.OCR_MAX_RETRIES || process.env.QUEUE_MAX_RETRIES || '5', 10);
const RETRY_DELAY_MS = parseInt(
  process.env.OCR_RETRY_DELAY_MS || process.env.QUEUE_RETRY_DELAY_MS || '15000',
  10
);

const OCR_QUEUE = ProcessingQueues.OCR.primary;
const OCR_RETRY_QUEUE = ProcessingQueues.OCR.retry;
const OCR_DLQ = ProcessingQueues.OCR.dlq;
const CLASSIFICATION_QUEUE = ProcessingQueues.CLASSIFICATION.primary;

interface OCRJobPayload {
  documentId: string;
  storageKey: string;
}

function getAttemptCount(msg: amqp.ConsumeMessage): number {
  const rawAttempts = msg.properties.headers?.['x-attempts'];
  if (typeof rawAttempts === 'number') {
    return rawAttempts;
  }
  const parsed = parseInt(String(rawAttempts ?? '0'), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildForwardPublishOptions(
  msg: amqp.ConsumeMessage,
  sourceService: string,
  overrides?: Record<string, unknown>
): amqp.Options.Publish {
  const traceId =
    (typeof msg.properties.headers?.['x-trace-id'] === 'string'
      ? (msg.properties.headers?.['x-trace-id'] as string)
      : undefined) || randomUUID();

  return {
    persistent: true,
    messageId: randomUUID(),
    correlationId: msg.properties.correlationId || msg.properties.messageId || traceId,
    headers: {
      ...(msg.properties.headers || {}),
      'x-trace-id': traceId,
      'x-attempts': 0,
      'x-source-service': sourceService,
      ...(overrides || {}),
    },
  };
}

async function handleOCRFailure(
  channel: amqp.Channel,
  msg: amqp.ConsumeMessage,
  payload: OCRJobPayload,
  attempts: number,
  error: unknown
): Promise<void> {
  const nextAttempt = attempts + 1;
  const errorMessage = error instanceof Error ? error.message : 'OCR processing failed';
  const shouldRetry = nextAttempt <= MAX_RETRIES;

  try {
    await db.query(
      `UPDATE documents
       SET status = $1,
           error_message = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [shouldRetry ? DocumentStatus.PROCESSING : DocumentStatus.ERROR, errorMessage, payload.documentId]
    );
  } catch (updateError) {
    logger.error(
      'Failed to update document status after OCR failure',
      updateError instanceof Error ? updateError : new Error(String(updateError))
    );
  }

  if (shouldRetry) {
    channel.sendToQueue(
      OCR_RETRY_QUEUE,
      msg.content,
      {
        persistent: true,
        messageId: msg.properties.messageId || randomUUID(),
        correlationId: msg.properties.correlationId || msg.properties.messageId || payload.documentId,
        headers: {
          ...(msg.properties.headers || {}),
          'x-attempts': nextAttempt,
          'x-last-error': errorMessage,
          'x-last-error-at': new Date().toISOString(),
          'x-source-service': 'ocr-service',
        },
      }
    );
    logger.warn('OCR job scheduled for retry', {
      documentId: payload.documentId,
      attempt: nextAttempt,
    });
  } else {
    const dlqPayload = {
      ...payload,
      error: errorMessage,
      attempts: nextAttempt,
      failedAt: new Date().toISOString(),
    };
    channel.sendToQueue(
      OCR_DLQ,
      Buffer.from(JSON.stringify(dlqPayload)),
      {
        persistent: true,
        headers: {
          ...(msg.properties.headers || {}),
          'x-attempts': nextAttempt,
          'x-source-service': 'ocr-service',
        },
      }
    );
    logger.error('OCR job moved to DLQ', { documentId: payload.documentId });
    recordQueueEvent({
      serviceName: 'ocr-service',
      queueName: OCR_DLQ,
      eventType: 'dlq_enqueue',
      metadata: {
        documentId: payload.documentId,
        attempts: nextAttempt,
        error: errorMessage,
      },
    });
  }

  channel.ack(msg);
}

async function startWorker(): Promise<void> {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    await channel.assertQueue(OCR_DLQ, { durable: true });
    await channel.assertQueue(OCR_QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': OCR_DLQ,
      },
    });
    await channel.assertQueue(OCR_RETRY_QUEUE, {
      durable: true,
      arguments: {
        'x-message-ttl': RETRY_DELAY_MS,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': OCR_QUEUE,
      },
    });
    await channel.assertQueue(CLASSIFICATION_QUEUE, { durable: true });
    channel.prefetch(1);

    logger.info('OCR worker started, waiting for jobs...');

    channel.consume(OCR_QUEUE, async (msg) => {
      if (!msg) {
        return;
      }

      let payload: OCRJobPayload;
      try {
        payload = JSON.parse(msg.content.toString());
      } catch (parseError) {
        logger.error(
          'Received malformed OCR payload',
          parseError instanceof Error ? parseError : new Error(String(parseError))
        );
        channel.ack(msg);
        return;
      }

      const attempts = getAttemptCount(msg);
      logger.info('Processing OCR job', { documentId: payload.documentId, storageKey: payload.storageKey, attempts });

      try {
        const fileBuffer = await getFile(payload.storageKey);
        const extractedText = await processOCRJob(fileBuffer, payload.storageKey);

        await db.transaction(async (client) => {
          const existing = await client.query('SELECT id FROM documents WHERE id = $1 FOR UPDATE', [
            payload.documentId,
          ]);
          if (existing.rowCount === 0) {
            throw new Error('Document not found');
          }

          await client.query(
            `UPDATE documents
             SET extracted_data = jsonb_set(
                   COALESCE(extracted_data, '{}'::jsonb),
                   '{rawText}',
                   to_jsonb($1::text),
                   true
                 ),
                 status = $2,
                 error_message = NULL,
                 updated_at = NOW()
             WHERE id = $3`,
            [extractedText, DocumentStatus.EXTRACTED, payload.documentId]
          );
        });

        const classificationPayload = JSON.stringify({
          documentId: payload.documentId,
          extractedText,
        });

        channel.sendToQueue(
          CLASSIFICATION_QUEUE,
          Buffer.from(classificationPayload),
          buildForwardPublishOptions(msg, 'ocr-service', {
            'x-previous-queue': OCR_QUEUE,
          })
        );
        channel.ack(msg);

        logger.info('OCR job completed', { documentId: payload.documentId });
      } catch (error) {
        logger.error('OCR job failed', error instanceof Error ? error : new Error(String(error)));
        await handleOCRFailure(channel, msg, payload, attempts, error);
      }
    });
  } catch (error) {
    logger.error('Failed to start OCR worker', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

void startWorker();
