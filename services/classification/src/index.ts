import amqp from 'amqplib';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';
import { createLogger } from '@ai-accountant/shared-utils';
import { processClassificationJob } from './processor';
import { db } from '@ai-accountant/database';
import { DocumentStatus, DocumentType, ProcessingQueues } from '@ai-accountant/shared-types';
import { validateDocumentForPosting } from '@ai-accountant/validation-service/services/documentPostingValidator';
import { recordQueueEvent } from '@ai-accountant/monitoring-service/services/queueMetrics';
import { routeToReviewQueue } from './services/reviewQueueManager';

config();

const logger = createLogger('classification-service');
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
const MAX_RETRIES = parseInt(
  process.env.CLASSIFICATION_MAX_RETRIES || process.env.QUEUE_MAX_RETRIES || '5',
  10
);
const RETRY_DELAY_MS = parseInt(
  process.env.CLASSIFICATION_RETRY_DELAY_MS || process.env.QUEUE_RETRY_DELAY_MS || '15000',
  10
);

const CLASSIFICATION_QUEUE = ProcessingQueues.CLASSIFICATION.primary;
const CLASSIFICATION_RETRY_QUEUE = ProcessingQueues.CLASSIFICATION.retry;
const CLASSIFICATION_DLQ = ProcessingQueues.CLASSIFICATION.dlq;
const LEDGER_QUEUE = ProcessingQueues.LEDGER.primary;
const LEDGER_DLQ = ProcessingQueues.LEDGER.dlq;

interface ClassificationJobPayload {
  documentId: string;
  extractedText: string;
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

async function handleClassificationFailure(
  channel: amqp.Channel,
  msg: amqp.ConsumeMessage,
  payload: ClassificationJobPayload,
  attempts: number,
  error: unknown
): Promise<void> {
  const nextAttempt = attempts + 1;
  const errorMessage = error instanceof Error ? error.message : 'Classification failed';
  const shouldRetry = nextAttempt <= MAX_RETRIES;
  const statusOnFailure = shouldRetry ? DocumentStatus.EXTRACTED : DocumentStatus.ERROR;
  recordQueueEvent({
    serviceName: 'classification-service',
    queueName: CLASSIFICATION_QUEUE,
    eventType: 'failure',
    metadata: {
      documentId: payload.documentId,
      attempts: nextAttempt,
      error: errorMessage,
    },
  });

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
      'Failed to update document status after classification failure',
      updateError instanceof Error ? updateError : new Error(String(updateError))
    );
  }

  if (shouldRetry) {
    channel.sendToQueue(
      CLASSIFICATION_RETRY_QUEUE,
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
          'x-source-service': 'classification-service',
        },
      }
    );
    recordQueueEvent({
      serviceName: 'classification-service',
      queueName: CLASSIFICATION_RETRY_QUEUE,
      eventType: 'enqueue',
      metadata: {
        documentId: payload.documentId,
        attempts: nextAttempt,
        retry: true,
      },
    });
    logger.warn('Classification job scheduled for retry', {
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
      CLASSIFICATION_DLQ,
      Buffer.from(JSON.stringify(dlqPayload)),
      {
        persistent: true,
        headers: {
          ...(msg.properties.headers || {}),
          'x-attempts': nextAttempt,
          'x-source-service': 'classification-service',
        },
      }
    );
    logger.error('Classification job moved to DLQ', { documentId: payload.documentId });
    recordQueueEvent({
      serviceName: 'classification-service',
      queueName: CLASSIFICATION_DLQ,
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

    await channel.assertQueue(CLASSIFICATION_DLQ, { durable: true });
    await channel.assertQueue(CLASSIFICATION_QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': CLASSIFICATION_DLQ,
      },
    });
    await channel.assertQueue(CLASSIFICATION_RETRY_QUEUE, {
      durable: true,
      arguments: {
        'x-message-ttl': RETRY_DELAY_MS,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': CLASSIFICATION_QUEUE,
      },
    });
    await channel.assertQueue(LEDGER_QUEUE, { durable: true });
    await channel.assertQueue(LEDGER_DLQ, { durable: true });
    channel.prefetch(1);

    logger.info('Classification worker started, waiting for jobs...');

    channel.consume(CLASSIFICATION_QUEUE, async (msg) => {
      if (!msg) {
        return;
      }

      let payload: ClassificationJobPayload;
      try {
        payload = JSON.parse(msg.content.toString());
      } catch (parseError) {
        logger.error(
          'Received malformed classification payload',
          parseError instanceof Error ? parseError : new Error(String(parseError))
        );
        channel.ack(msg);
        return;
      }

        const attempts = getAttemptCount(msg);
        logger.info('Processing classification job', { documentId: payload.documentId, attempts });
        let tenantId: string | null = null;
        recordQueueEvent({
          serviceName: 'classification-service',
          queueName: CLASSIFICATION_QUEUE,
          eventType: 'start',
          metadata: {
            documentId: payload.documentId,
            attempts,
          },
        });

      try {
        const result = await processClassificationJob(payload.extractedText);

        await db.transaction(async (client) => {
          const existing = await client.query(
            'SELECT id, tenant_id FROM documents WHERE id = $1 FOR UPDATE',
            [payload.documentId]
          );
          if (existing.rowCount === 0) {
            throw new Error('Document not found');
          }
          tenantId = existing.rows[0].tenant_id;

          await client.query(
            `UPDATE documents
             SET document_type = $1,
                 extracted_data = jsonb_set(
                   COALESCE(extracted_data, '{}'::jsonb),
                   '{classification}',
                   $2::jsonb,
                   true
                 ),
                 confidence_score = $3,
                 status = $4,
                 error_message = NULL,
                 updated_at = NOW()
             WHERE id = $5`,
            [
              result.documentType,
              JSON.stringify(result.extractedData),
              result.confidenceScore,
              DocumentStatus.CLASSIFIED,
              payload.documentId,
            ]
          );
        });

        // Route to review queue if confidence or quality is low
        if (tenantId) {
          try {
            const needsReview = await routeToReviewQueue(tenantId, payload.documentId);
            if (needsReview) {
              logger.info('Document routed to review queue', { documentId: payload.documentId, tenantId });
            }
          } catch (reviewError) {
            logger.warn('Failed to route to review queue', {
              documentId: payload.documentId,
              error: reviewError instanceof Error ? reviewError : new Error(String(reviewError)),
            });
            // Don't fail the classification if review routing fails
          }
        }

        const shouldPostToLedger =
          result.documentType === DocumentType.INVOICE || result.documentType === DocumentType.RECEIPT;

        if (shouldPostToLedger) {
          if (!tenantId) {
            throw new Error('Tenant not found for document');
          }

          const validationResult = await validateDocumentForPosting(tenantId, payload.documentId);
          if (!validationResult.isValid) {
            const validationMessage = validationResult.errors.join('; ') || 'Document failed validation checks';
            await db.query(
              `UPDATE documents
               SET error_message = $1,
                   updated_at = NOW()
               WHERE id = $2`,
              [validationMessage, payload.documentId]
            );

            logger.warn('Document held for manual review after validation', {
              documentId: payload.documentId,
              errors: validationResult.errors,
            });
            channel.ack(msg);
            return;
          }

          const ledgerHeaders: Record<string, unknown> = { 'x-previous-queue': CLASSIFICATION_QUEUE };
          if (tenantId) {
            ledgerHeaders['x-tenant-id'] = tenantId;
          }

            channel.sendToQueue(
              LEDGER_QUEUE,
              Buffer.from(JSON.stringify({ documentId: payload.documentId, classification: result })),
              buildForwardPublishOptions(msg, 'classification-service', ledgerHeaders)
            );
            recordQueueEvent({
              serviceName: 'classification-service',
              queueName: LEDGER_QUEUE,
              eventType: 'enqueue',
              metadata: {
                documentId: payload.documentId,
              },
            });
          logger.info('Document queued for ledger posting', { documentId: payload.documentId });
        }

        recordQueueEvent({
          serviceName: 'classification-service',
          queueName: CLASSIFICATION_QUEUE,
          eventType: 'success',
          metadata: {
            documentId: payload.documentId,
          },
        });
        channel.ack(msg);
        logger.info('Classification job completed', {
          documentId: payload.documentId,
          type: result.documentType,
        });
      } catch (error) {
        logger.error('Classification job failed', error instanceof Error ? error : new Error(String(error)));
        await handleClassificationFailure(channel, msg, payload, attempts, error);
      }
    });
  } catch (error) {
    logger.error('Failed to start classification worker', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

void startWorker();
