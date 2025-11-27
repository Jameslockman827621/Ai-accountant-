import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('billing-service');

interface CommercePaymentIntentResponse {
  clientSecret: string;
  id: string;
  currency: string;
  amount: number;
}

export async function createCommercePaymentIntent(
  tenantId: TenantId,
  amount: number,
  currency: string,
  metadata?: Record<string, unknown>
): Promise<CommercePaymentIntentResponse> {
  const fetchFn = (globalThis as any).fetch as typeof fetch | undefined;
  if (!fetchFn) {
    throw new Error('Fetch API not available in billing service runtime');
  }

  const baseUrl = process.env.COMMERCE_SERVICE_URL || 'http://commerce-service:3005';
  const response = await fetchFn(`${baseUrl}/api/commerce/payment-intents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
    },
    body: JSON.stringify({ amount, currency, metadata }),
  });

  if (!response.ok) {
    const message = await response.text();
    logger.error('Commerce payment intent failed', new Error(message));
    throw new Error('Unable to create payment intent');
  }

  const body = (await response.json()) as CommercePaymentIntentResponse;
  return body;
}
