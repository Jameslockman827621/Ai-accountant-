import crypto from 'node:crypto';
import { createLogger } from '@ai-accountant/shared-utils';
import { notificationManager } from '@ai-accountant/notification-service/services/notificationManager';

const logger = createLogger('billing-service');

export interface BraintreeWebhookEvent {
  id: string;
  type: string;
  tenantId?: string;
  payload: Record<string, unknown>;
}

export function verifyBraintreeSignature(payload: string, signature: string): {
  valid: boolean;
  event: BraintreeWebhookEvent;
} {
  const secret = process.env.BRAINTREE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('BRAINTREE_WEBHOOK_SECRET not configured');
  }

  const computed = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const valid = crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch (error) {
    logger.warn('Unable to parse Braintree payload', error instanceof Error ? error : new Error(String(error)));
  }

  const event: BraintreeWebhookEvent = {
    id: (parsed.id as string) || crypto.randomUUID(),
    type: (parsed.kind as string) || 'unknown',
    tenantId: (parsed.subscription as Record<string, unknown> | undefined)?.tenantId as string | undefined,
    payload: parsed,
  };

  return { valid, event };
}

export async function handleBraintreeWebhook(event: BraintreeWebhookEvent): Promise<void> {
  logger.info('Processing Braintree webhook', { eventId: event.id, type: event.type });

  switch (event.type) {
    case 'subscription_charged_successfully': {
      await notificationManager.createNotification(
        event.tenantId || 'unknown',
        null,
        'info',
        'Subscription Payment Captured',
        'Your subscription payment was captured successfully.',
        undefined,
        { provider: 'braintree', eventId: event.id }
      );
      break;
    }
    case 'subscription_charged_unsuccessfully': {
      await notificationManager.createNotification(
        event.tenantId || 'unknown',
        null,
        'error',
        'Payment Failed',
        'We were unable to collect your latest payment. Please update your payment method to avoid service interruption.',
        { label: 'Update payment method', url: '/billing' },
        { provider: 'braintree', eventId: event.id }
      );
      break;
    }
    default:
      logger.debug('Unhandled Braintree event type', { type: event.type });
  }
}
