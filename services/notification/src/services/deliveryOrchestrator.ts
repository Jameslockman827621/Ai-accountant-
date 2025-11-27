import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { enhancedNotificationService, NotificationChannel } from './enhancedNotification';
import { retryWithCircuitBreaker } from '@ai-accountant/resilience/services/retry';
import { resolveStandardPolicy } from '@ai-accountant/resilience/errorStandards';

const logger = createLogger('notification-service');

export interface DeliveryRequest {
  tenantId: TenantId;
  userId: UserId | null;
  templateId: string;
  variables: Record<string, unknown>;
  channels: NotificationChannel[];
}

export async function deliverWithResilience(request: DeliveryRequest): Promise<string[]> {
  const policy = resolveStandardPolicy('integration', 'E_INTEGRATION_001');
  const deliveries: string[] = [];

  for (const channel of request.channels) {
    const deliveryId = await retryWithCircuitBreaker(
      () =>
        enhancedNotificationService.sendNotification(
          request.tenantId,
          request.userId,
          request.templateId,
          request.variables,
          [channel]
        ),
      `${channel}-notification`,
      {
        maxAttempts: policy.retryPolicy.maxAttempts,
        initialDelay: policy.retryPolicy.initialDelayMs,
        maxDelay: policy.retryPolicy.maxDelayMs,
        backoffMultiplier: policy.retryPolicy.backoffMultiplier,
      }
    );

    deliveries.push(...deliveryId);
    logger.info('Notification delivery scheduled with resilience', { deliveryId, channel });
  }

  return deliveries;
}
