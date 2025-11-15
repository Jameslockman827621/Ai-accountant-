import { createLogger } from '@ai-accountant/shared-utils';
import { metricsCollector } from './metrics';

const logger = createLogger('monitoring-service');

const DLQ_ALERT_THRESHOLD = parseInt(process.env.DLQ_ALERT_THRESHOLD || '10', 10);
const dlqDepthByQueue = new Map<string, number>();

export type QueueEventType = 'dlq_enqueue' | 'dlq_release';

export interface QueueEvent {
  serviceName: string;
  queueName: string;
  eventType: QueueEventType;
  metadata?: Record<string, unknown>;
}

export function recordQueueEvent(event: QueueEvent): void {
  metricsCollector.recordMetric({
    name: 'queue_event',
    value: 1,
    tags: {
      service: event.serviceName,
      queue: event.queueName,
      event: event.eventType,
    },
    timestamp: new Date(),
  });

  if (event.eventType === 'dlq_enqueue') {
    const depth = (dlqDepthByQueue.get(event.queueName) ?? 0) + 1;
    dlqDepthByQueue.set(event.queueName, depth);

    if (depth >= DLQ_ALERT_THRESHOLD) {
      logger.warn('DLQ depth threshold exceeded', {
        queue: event.queueName,
        depth,
        service: event.serviceName,
        metadata: event.metadata,
      });
    }
  } else if (event.eventType === 'dlq_release') {
    const depth = Math.max((dlqDepthByQueue.get(event.queueName) ?? 1) - 1, 0);
    dlqDepthByQueue.set(event.queueName, depth);
  }
}
