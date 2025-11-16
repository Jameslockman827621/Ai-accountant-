import { createLogger } from '@ai-accountant/shared-utils';
import { connectorProvisioningWorker } from './connectorProvisioning';

const logger = createLogger('onboarding-events');

/**
 * Emit onboarding event to RabbitMQ
 * In production, this would connect to RabbitMQ and publish events
 * For now, we'll log the events and provide a stub implementation
 */
export async function emitOnboardingEvent(
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    // In production, this would use amqplib or similar to publish to RabbitMQ
    // For now, we'll log the event
    logger.info('Onboarding event emitted', {
      eventType,
      payload,
    });

    // Handle onboarding.completed event (Chunk 3)
    if (eventType === 'onboarding.completed' && payload.tenantId) {
      await connectorProvisioningWorker.handleOnboardingCompleted(payload.tenantId as string);
    }

    // TODO: Implement actual RabbitMQ publishing
    // Example:
    // const channel = await getRabbitMQChannel();
    // await channel.publish(
    //   'onboarding-events',
    //   eventType,
    //   Buffer.from(JSON.stringify(payload)),
    //   { persistent: true }
    // );

    // For development/testing, we can also emit to a local event emitter
    // or store in a queue table for processing
  } catch (error) {
    logger.error('Failed to emit onboarding event', error instanceof Error ? error : new Error(String(error)));
    // Don't throw - event emission failures shouldn't break the onboarding flow
  }
}
