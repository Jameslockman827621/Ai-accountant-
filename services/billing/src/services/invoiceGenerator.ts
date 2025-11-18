import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

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
  paidAt?: Date;
  createdAt: Date;
}

/**
 * Generate invoice for users (billing history)
 */
export async function generateInvoice(
  tenantId: TenantId,
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>,
  issueDate?: Date,
  dueDate?: Date
): Promise<Invoice> {
  logger.info('Generating invoice', { tenantId });

  const invoiceId = randomUUID();
  const issue = issueDate || new Date();
  const due = dueDate || new Date(issue.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  // Calculate totals
  const lineItemsWithTotal = lineItems.map(item => ({
    ...item,
    total: item.quantity * item.unitPrice,
  }));

  const subtotal = lineItemsWithTotal.reduce((sum, item) => sum + item.total, 0);
  const tax = subtotal * 0.20; // 20% VAT (UK)
  const total = subtotal + tax;

  // Generate invoice number
  const invoiceNumber = `INV-${issue.getFullYear()}-${String(invoiceId).substring(0, 8).toUpperCase()}`;

  // Store invoice
  await db.query(
    `INSERT INTO invoices (
      id, tenant_id, invoice_number, issue_date, due_date,
      amount, currency, status, line_items, subtotal, tax, total,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, NOW(), NOW())`,
    [
      invoiceId,
      tenantId,
      invoiceNumber,
      issue,
      due,
      total,
      'GBP',
      'sent',
      JSON.stringify(lineItemsWithTotal),
      subtotal,
      tax,
      total,
    ]
  );

  logger.info('Invoice generated', { invoiceId, invoiceNumber, tenantId });

  return {
    id: invoiceId,
    tenantId,
    invoiceNumber,
    issueDate: issue,
    dueDate: due,
    amount: total,
    currency: 'GBP',
    status: 'sent',
    lineItems: lineItemsWithTotal,
    subtotal,
    tax,
    total,
    createdAt: new Date(),
  };
}

/**
 * Get invoices for a tenant
 */
export async function getInvoices(
  tenantId: TenantId,
  status?: Invoice['status'],
  limit = 50
): Promise<Invoice[]> {
  let query = `SELECT 
     id, tenant_id, invoice_number, issue_date, due_date,
     amount, currency, status, line_items, subtotal, tax, total,
     paid_at, created_at
   FROM invoices
   WHERE tenant_id = $1`;

  const params: unknown[] = [tenantId];

  if (status) {
    query += ' AND status = $2';
    params.push(status);
  }

  query += ' ORDER BY issue_date DESC LIMIT $' + (params.length + 1);
  params.push(limit);

  const result = await db.query<{
    id: string;
    tenant_id: string;
    invoice_number: string;
    issue_date: Date;
    due_date: Date;
    amount: number;
    currency: string;
    status: string;
    line_items: string;
    subtotal: number;
    tax: number;
    total: number;
    paid_at: Date | null;
    created_at: Date;
  }>(query, params);

  return result.rows.map(row => {
    const baseInvoice: Invoice = {
      id: row.id,
      tenantId: row.tenant_id as TenantId,
      invoiceNumber: row.invoice_number,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      amount: parseFloat(String(row.amount)),
      currency: row.currency,
      status: row.status as Invoice['status'],
      lineItems: JSON.parse(row.line_items) as Invoice['lineItems'],
      subtotal: parseFloat(String(row.subtotal)),
      tax: parseFloat(String(row.tax)),
      total: parseFloat(String(row.total)),
      createdAt: row.created_at,
    };

    return row.paid_at ? { ...baseInvoice, paidAt: row.paid_at } : baseInvoice;
  });
}

/**
 * Mark invoice as paid
 */
export async function markInvoicePaid(invoiceId: string, tenantId: TenantId): Promise<void> {
  await db.query(
    `UPDATE invoices
     SET status = 'paid',
         paid_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [invoiceId, tenantId]
  );

  logger.info('Invoice marked as paid', { invoiceId, tenantId });
}
