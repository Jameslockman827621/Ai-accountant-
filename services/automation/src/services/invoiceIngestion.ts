import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

export type InvoiceIngestion = {
  id: string;
  tenantId: TenantId;
  createdBy: UserId;
  vendor: string;
  amount: number;
  currency: string;
  status: 'pending' | 'approved' | 'rejected';
  approvalNotes?: string;
  approvalBy?: UserId;
  dueDate?: string;
};

const logger = createLogger('invoice-ingestion');
const ingestions: InvoiceIngestion[] = [];

export function ingestInvoice(payload: Omit<InvoiceIngestion, 'id' | 'status'>): InvoiceIngestion {
  const record: InvoiceIngestion = {
    ...payload,
    id: `invoice_${Date.now()}`,
    status: 'pending',
  };
  ingestions.push(record);
  logger.info('Invoice ingested for approval', { tenantId: payload.tenantId, invoiceId: record.id });
  return record;
}

export function listInvoices(tenantId: TenantId): InvoiceIngestion[] {
  return ingestions.filter(row => row.tenantId === tenantId);
}

export function resolveInvoice(
  tenantId: TenantId,
  invoiceId: string,
  status: 'approved' | 'rejected',
  approvalBy: UserId,
  approvalNotes?: string
): InvoiceIngestion | undefined {
  const record = ingestions.find(row => row.tenantId === tenantId && row.id === invoiceId);
  if (!record) {
    return undefined;
  }
  record.status = status;
  record.approvalBy = approvalBy;
  record.approvalNotes = approvalNotes;
  return record;
}
