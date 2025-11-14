import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('billing-service');

export interface Invoice {
  id: string;
  tenantId: TenantId;
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  subtotal: number;
  tax: number;
  total: number;
}

export async function generateInvoice(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<Invoice> {
  logger.info('Generating invoice', { tenantId, periodStart, periodEnd });

  // Get subscription
  const subscription = await db.query<{
    tier: string;
  }>(
    'SELECT tier FROM subscriptions WHERE tenant_id = $1',
    [tenantId]
  );

  if (subscription.rows.length === 0) {
    throw new Error('No subscription found');
  }

  const tier = subscription.rows[0].tier;

  // Get usage for the period
  const usage = await db.query<{
    documents_processed: number;
    ocr_requests: number;
    llm_queries: number;
    storage_used: number;
  }>(
    `SELECT documents_processed, ocr_requests, llm_queries, storage_used
     FROM usage_metrics
     WHERE tenant_id = $1 AND period = $2`,
    [tenantId, periodStart.toISOString().slice(0, 7)]
  );

  const usageData = usage.rows[0] || {
    documents_processed: 0,
    ocr_requests: 0,
    llm_queries: 0,
    storage_used: 0,
  };

  // Tier pricing (example)
  const tierPricing: Record<string, number> = {
    freelancer: 29.99,
    sme: 79.99,
    accountant: 199.99,
    enterprise: 499.99,
  };

  const basePrice = tierPricing[tier] || 29.99;

  // Calculate line items
  const lineItems = [
    {
      description: `Subscription - ${tier} tier`,
      quantity: 1,
      unitPrice: basePrice,
      total: basePrice,
    },
  ];

  // Add overage charges if applicable
  const tierLimits: Record<string, { documents: number }> = {
    freelancer: { documents: 100 },
    sme: { documents: 500 },
    accountant: { documents: 2000 },
    enterprise: { documents: -1 },
  };

  const limits = tierLimits[tier] || tierLimits.freelancer;
  if (limits.documents > 0 && usageData.documents_processed > limits.documents) {
    const overage = usageData.documents_processed - limits.documents;
    lineItems.push({
      description: `Document processing overage (${overage} documents)`,
      quantity: overage,
      unitPrice: 0.10, // £0.10 per document
      total: overage * 0.10,
    });
  }

  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const tax = subtotal * 0.20; // 20% VAT
  const total = subtotal + tax;

  const invoiceId = crypto.randomUUID();
  const invoiceNumber = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
  const issueDate = new Date();
  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + 30); // 30 days to pay

  // Store invoice (would need invoices table)
  // For now, just return the invoice object

  return {
    id: invoiceId,
    tenantId,
    invoiceNumber,
    issueDate,
    dueDate,
    amount: total,
    currency: 'GBP',
    status: 'draft',
    lineItems,
    subtotal,
    tax,
    total,
  };
}
