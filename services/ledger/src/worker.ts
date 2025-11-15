import amqp from 'amqplib';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { DocumentStatus, ProcessingQueues } from '@ai-accountant/shared-types';
import { postDocumentToLedger } from './services/posting';
import { recordQueueEvent } from '@ai-accountant/monitoring-service/services/queueMetrics';

config();

const logger = createLogger('ledger-service');
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
const MAX_RETRIES = parseInt(process.env.LEDGER_MAX_RETRIES || process.env.QUEUE_MAX_RETRIES || '5', 10);
const RETRY_DELAY_MS = parseInt(
  process.env.LEDGER_RETRY_DELAY_MS || process.env.QUEUE_RETRY_DELAY_MS || '30000',
  10
);

const LEDGER_QUEUE = ProcessingQueues.LEDGER.primary;
const LEDGER_RETRY_QUEUE = ProcessingQueues.LEDGER.retry;
const LEDGER_DLQ = ProcessingQueues.LEDGER.dlq;

interface LedgerJobPayload {
  documentId: string;
  metadata?: Record<string, unknown>;
}

function getAttemptCount(msg: amqp.ConsumeMessage): number {
  const rawAttempts = msg.properties.headers?.['x-attempts'];
  if (typeof rawAttempts === 'number') {
    return rawAttempts;
  }
  const parsed = parseInt(String(rawAttempts ?? '0'), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function startWorker(): Promise<void> {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    await channel.assertQueue(LEDGER_DLQ, { durable: true });
    await channel.assertQueue(LEDGER_QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': LEDGER_DLQ,
      },
    });
    await channel.assertQueue(LEDGER_RETRY_QUEUE, {
      durable: true,
      arguments: {
        'x-message-ttl': RETRY_DELAY_MS,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': LEDGER_QUEUE,
      },
    });
    channel.prefetch(1);

    logger.info('Ledger posting worker started, waiting for jobs...');

    channel.consume(LEDGER_QUEUE, async (msg) => {
      if (!msg) {
        return;
      }

      let payload: LedgerJobPayload;
      try {
        payload = JSON.parse(msg.content.toString());
      } catch (parseError) {
        logger.error(
          'Received malformed ledger payload',
          parseError instanceof Error ? parseError : new Error(String(parseError))
        );
        channel.ack(msg);
        return;
      }

      if (!payload.documentId) {
        logger.error('Ledger payload missing documentId');
        channel.ack(msg);
        return;
      }

      const attempts = getAttemptCount(msg);
      logger.info('Processing ledger posting job', { documentId: payload.documentId, attempts });

      try {
        const doc = await db.transaction(async (client) => {
          const result = await client.query<{
            tenant_id: string;
            uploaded_by: string;
          }>('SELECT tenant_id, uploaded_by FROM documents WHERE id = $1 FOR UPDATE', [payload.documentId]);

          if (result.rows.length === 0) {
            throw new Error('Document not found');
          }

          await client.query(
            `UPDATE documents
             SET status = $1,
                 error_message = NULL,
                 updated_at = NOW()
             WHERE id = $2`,
            [DocumentStatus.PROCESSING, payload.documentId]
          );

          return result.rows[0];
        });

        await postDocumentToLedger(doc.tenant_id, payload.documentId, doc.uploaded_by);

        channel.ack(msg);
        logger.info('Ledger posting job completed', { documentId: payload.documentId });
      } catch (error) {
        logger.error('Ledger posting job failed', error instanceof Error ? error : new Error(String(error)));
        await handleLedgerFailure(channel, msg, payload, attempts, error);
      }
    });
  } catch (error) {
    logger.error('Failed to start ledger worker', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

async function handleLedgerFailure(
  channel: amqp.Channel,
  msg: amqp.ConsumeMessage,
  payload: LedgerJobPayload,
  attempts: number,
  error: unknown
): Promise<void> {
  const nextAttempt = attempts + 1;
  const errorMessage = error instanceof Error ? error.message : 'Ledger posting failed';
  const isValidationError = error instanceof ValidationError;
  const shouldRetry = !isValidationError && nextAttempt <= MAX_RETRIES;
  const statusOnFailure = isValidationError
    ? DocumentStatus.CLASSIFIED
    : shouldRetry
      ? DocumentStatus.PROCESSING
      : DocumentStatus.ERROR;

  try {
    await db.query(
      `UPDATE documents
       SET status = $1,
           error_message = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [statusOnFailure, errorMessage, payload.documentId]
    );
  } catch (updateError) {
    logger.error(
      'Failed to update document status after ledger failure',
      updateError instanceof Error ? updateError : new Error(String(updateError))
    );
  }

  if (shouldRetry) {
    channel.sendToQueue(
      LEDGER_RETRY_QUEUE,
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
          'x-source-service': 'ledger-service',
        },
      }
    );
    logger.warn('Ledger posting job scheduled for retry', {
      documentId: payload.documentId,
      attempt: nextAttempt,
    });
  } else {
    const dlqPayload = {
      documentId: payload.documentId,
      metadata: payload.metadata,
      error: errorMessage,
      attempts: nextAttempt,
      failedAt: new Date().toISOString(),
      validationError: isValidationError,
    };

    channel.sendToQueue(
      LEDGER_DLQ,
      Buffer.from(JSON.stringify(dlqPayload)),
      {
        persistent: true,
        headers: {
          ...(msg.properties.headers || {}),
          'x-attempts': nextAttempt,
          'x-source-service': 'ledger-service',
        },
      }
    );

    if (isValidationError) {
      logger.warn('Ledger posting deferred for manual review', {
        documentId: payload.documentId,
        reason: errorMessage,
      });
    } else {
      logger.error('Ledger posting moved to DLQ', { documentId: payload.documentId });
    }

    recordQueueEvent({
      serviceName: 'ledger-service',
      queueName: LEDGER_DLQ,
      eventType: 'dlq_enqueue',
      metadata: {
        documentId: payload.documentId,
        attempts: nextAttempt,
        error: errorMessage,
        validationError: isValidationError,
      },
    });
  }

  channel.ack(msg);
}

void startWorker();
