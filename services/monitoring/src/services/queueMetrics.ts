import { createLogger } from '@ai-accountant/shared-utils';
import { ProcessingQueues, ProcessingQueueName } from '@ai-accountant/shared-types';
import { metricsCollector } from './metrics';

const logger = createLogger('monitoring-service');

const DLQ_ALERT_THRESHOLD = parseInt(process.env.DLQ_ALERT_THRESHOLD || '10', 10);

export type QueueEventType =
  | 'enqueue'
  | 'start'
  | 'success'
  | 'failure'
  | 'dlq_enqueue'
  | 'dlq_release';

export interface QueueEvent {
  serviceName: string;
  queueName: string;
  eventType: QueueEventType;
  metadata?: Record<string, unknown>;
}

interface QueueStats {
  queueKey: string;
  queueName: string;
  enqueued: number;
  started: number;
  succeeded: number;
  failed: number;
  dlqDepth: number;
  lastError?: {
    message: string;
    documentId?: string;
    at?: string;
    service?: string;
  };
  lastEventAt?: string;
}

export interface QueueHealth extends QueueStats {
  pending: number;
  inFlight: number;
}

const queueStats = new Map<string, QueueStats>();
const queueNameToKey = buildQueueNameMap();

function buildQueueNameMap(): Map<string, { key: string; primary: string }> {
  const map = new Map<string, { key: string; primary: string }>();
  (Object.entries(ProcessingQueues) as Array<[ProcessingQueueName, (typeof ProcessingQueues)[ProcessingQueueName]]>).forEach(
    ([key, config]) => {
      map.set(config.primary, { key, primary: config.primary });
      map.set(config.retry, { key, primary: config.primary });
      map.set(config.dlq, { key, primary: config.primary });
    }
  );
  return map;
}

function resolveQueue(queueName: string): { statsKey: string; primaryName: string } {
  const mapping = queueNameToKey.get(queueName);
  if (mapping) {
    return {
      statsKey: mapping.key,
      primaryName: mapping.primary,
    };
  }

  return {
    statsKey: queueName,
    primaryName: queueName,
  };
}

function getOrCreateStats(queueName: string): QueueStats {
  const { statsKey, primaryName } = resolveQueue(queueName);

  if (!queueStats.has(statsKey)) {
    queueStats.set(statsKey, {
      queueKey: statsKey,
      queueName: primaryName,
      enqueued: 0,
      started: 0,
      succeeded: 0,
      failed: 0,
      dlqDepth: 0,
    });
  }

  return queueStats.get(statsKey)!;
}

export function recordQueueEvent(event: QueueEvent): void {
  const stats = getOrCreateStats(event.queueName);
  const timestamp = new Date().toISOString();
  stats.lastEventAt = timestamp;

  metricsCollector.recordMetric({
    name: 'queue_event',
    value: 1,
    tags: {
      service: event.serviceName,
      queue: stats.queueName,
      event: event.eventType,
    },
    timestamp: new Date(timestamp),
  });

  switch (event.eventType) {
    case 'enqueue':
      stats.enqueued += 1;
      break;
    case 'start':
      stats.started += 1;
      break;
    case 'success':
      stats.succeeded += 1;
      break;
    case 'failure': {
      stats.failed += 1;
      const errorMessage =
        (typeof event.metadata?.error === 'string' && event.metadata.error) || 'Queue job failed';
      const documentId =
        typeof event.metadata?.documentId === 'string' ? event.metadata.documentId : undefined;
      stats.lastError = {
        message: errorMessage,
        ...(documentId ? { documentId } : {}),
        at: timestamp,
        service: event.serviceName,
      };
      break;
    }
    case 'dlq_enqueue': {
      stats.dlqDepth += 1;
      const errorMessage =
        (typeof event.metadata?.error === 'string' && event.metadata.error) || 'Job moved to DLQ';
      const documentId =
        typeof event.metadata?.documentId === 'string' ? event.metadata.documentId : undefined;
      stats.lastError = {
        message: errorMessage,
        ...(documentId ? { documentId } : {}),
        at: timestamp,
        service: event.serviceName,
      };

      if (stats.dlqDepth >= DLQ_ALERT_THRESHOLD) {
        logger.warn('DLQ depth threshold exceeded', {
          queue: stats.queueName,
          depth: stats.dlqDepth,
          service: event.serviceName,
          metadata: event.metadata,
        });
      }
      break;
    }
    case 'dlq_release':
      stats.dlqDepth = Math.max(stats.dlqDepth - 1, 0);
      break;
    default:
      break;
  }
}

export function getQueueHealth(): QueueHealth[] {
  return Array.from(queueStats.values())
    .map((stats) => {
      const pending = Math.max(stats.enqueued - stats.started, 0);
      const inFlight = Math.max(stats.started - stats.succeeded - stats.failed, 0);
      return {
        ...stats,
        pending,
        inFlight,
      };
    })
    .sort((a, b) => a.queueKey.localeCompare(b.queueKey));
}
