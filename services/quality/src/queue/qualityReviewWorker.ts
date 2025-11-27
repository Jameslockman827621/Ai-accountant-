import * as amqp from 'amqplib';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { ProcessingQueues, QualityReviewJobPayload } from '@ai-accountant/shared-types';

config();

const logger = createLogger('quality-review-worker');
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
const QUALITY_QUEUE = ProcessingQueues.QUALITY_REVIEW.primary;
const QUALITY_RETRY_QUEUE = ProcessingQueues.QUALITY_REVIEW.retry;
const QUALITY_DLQ = ProcessingQueues.QUALITY_REVIEW.dlq;
const MAX_ATTEMPTS = parseInt(process.env.QUALITY_REVIEW_MAX_RETRIES || '3', 10);
const RETRY_DELAY_MS = parseInt(process.env.QUEUE_RETRY_DELAY_MS || '15000', 10);

async function ensureQueues(channel: amqp.Channel): Promise<void> {
  await channel.assertQueue(QUALITY_QUEUE, { durable: true });
  await channel.assertQueue(QUALITY_RETRY_QUEUE, {
    durable: true,
    arguments: {
      'x-message-ttl': RETRY_DELAY_MS,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': QUALITY_QUEUE,
    },
  });
  await channel.assertQueue(QUALITY_DLQ, { durable: true });
}

function parsePayload(msg: amqp.ConsumeMessage): QualityReviewJobPayload | null {
  try {
    const data = JSON.parse(msg.content.toString());
    if (!data.documentId || !data.tenantId) {
      return null;
    }
    return data as QualityReviewJobPayload;
  } catch (error) {
    logger.error('Failed to parse quality review payload', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

async function enqueueForReview(payload: QualityReviewJobPayload): Promise<void> {
  const priorityScore = Math.max(10, 100 - Math.round(payload.qualityScore || 0));
  const hasCritical = payload.issues.some(issue => issue.severity === 'critical');
  const riskLevel = hasCritical ? 'high' : 'medium';
  const slaDeadline = new Date();
  slaDeadline.setHours(slaDeadline.getHours() + (riskLevel === 'high' ? 12 : 24));

  const riskFactors = {
    gate: 'quality',
    issues: payload.issues.map(issue => issue.id),
    storageKey: payload.storageKey,
    source: payload.source,
  };

  const queueId = randomUUID();
  await db.query(
    `INSERT INTO review_queue (
        id, tenant_id, document_id, priority_score, risk_level, risk_factors,
        reviewer_skill_required, status, sla_deadline, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, NOW(), NOW())
      ON CONFLICT (document_id) DO UPDATE SET
        priority_score = EXCLUDED.priority_score,
        risk_level = EXCLUDED.risk_level,
        risk_factors = EXCLUDED.risk_factors,
        reviewer_skill_required = EXCLUDED.reviewer_skill_required,
        sla_deadline = EXCLUDED.sla_deadline,
        updated_at = NOW()`,
    [
      queueId,
      payload.tenantId,
      payload.documentId,
      priorityScore,
      riskLevel,
      JSON.stringify(riskFactors),
      'document_quality',
      'pending',
      slaDeadline,
    ]
  );

  logger.info('Document routed to quality review queue', {
    queueId,
    documentId: payload.documentId,
    tenantId: payload.tenantId,
    riskLevel,
    priorityScore,
  });
}

function getAttemptCount(msg: amqp.ConsumeMessage): number {
  const attempts = msg.properties.headers?.['x-attempts'];
  if (typeof attempts === 'number') return attempts;
  const parsed = parseInt(String(attempts ?? '0'), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function handleFailure(
  channel: amqp.Channel,
  msg: amqp.ConsumeMessage,
  attempts: number,
  error: unknown
): Promise<void> {
  const nextAttempt = attempts + 1;
  const headers = {
    ...(msg.properties.headers || {}),
    'x-attempts': nextAttempt,
  };

  if (nextAttempt > MAX_ATTEMPTS) {
    logger.error('Quality review job failed, sending to DLQ', error instanceof Error ? error : new Error(String(error)));
    channel.sendToQueue(QUALITY_DLQ, msg.content, { persistent: true, headers });
    channel.ack(msg);
    return;
  }

  logger.warn('Quality review job failed, retrying', {
    attempts: nextAttempt,
    error: error instanceof Error ? error.message : String(error),
  });
  channel.sendToQueue(QUALITY_RETRY_QUEUE, msg.content, { persistent: true, headers });
  channel.ack(msg);
}

export async function startQualityReviewWorker(): Promise<void> {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();
  await ensureQueues(channel);

  await channel.consume(QUALITY_QUEUE, async (msg) => {
    if (!msg) {
      return;
    }

    const payload = parsePayload(msg);
    if (!payload) {
      logger.warn('Discarding malformed quality review job');
      channel.ack(msg);
      return;
    }

    try {
      await enqueueForReview(payload);
      channel.ack(msg);
    } catch (error) {
      const attempts = getAttemptCount(msg);
      await handleFailure(channel, msg, attempts, error);
    }
  });

  connection.on('error', (err) => {
    logger.error('Quality review queue connection error', err instanceof Error ? err : new Error(String(err)));
  });

  logger.info('Quality review worker is consuming queue');
}
