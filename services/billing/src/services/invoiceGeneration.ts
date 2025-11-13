import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import PDFDocument from 'pdfkit';

const logger = createLogger('billing-service');

export interface InvoiceTemplate {
  id: string;
  tenantId: TenantId;
  name: string;
  template: {
    header: {
      logo?: string;
      companyName: string;
      address: string;
      contactInfo: string;
    };
    footer: {
      terms: string;
      paymentTerms: string;
    };
    styling: {
      primaryColor: string;
      font: string;
    };
  };
}

export interface Invoice {
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  from: {
    name: string;
    address: string;
    vatNumber?: string;
  };
  to: {
    name: string;
    address: string;
    vatNumber?: string;
  };
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    total: number;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
}

/**
 * Generate invoice PDF with template
 */
export async function generateInvoicePDF(
  tenantId: TenantId,
  invoice: Invoice,
  templateId?: string
): Promise<Buffer> {
  logger.info('Generating invoice PDF', { tenantId, invoiceNumber: invoice.invoiceNumber });

  // Get template
  let template: InvoiceTemplate | null = null;
  if (templateId) {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      name: string;
      template: unknown;
    }>(
      'SELECT * FROM invoice_templates WHERE id = $1 AND tenant_id = $2',
      [templateId, tenantId]
    );

    if (result.rows.length > 0) {
      template = {
        id: result.rows[0].id,
        tenantId: result.rows[0].tenant_id,
        name: result.rows[0].name,
        template: result.rows[0].template as InvoiceTemplate['template'],
      };
    }
  }

  // Generate PDF
  const doc = new PDFDocument({ margin: 50 });
  const chunks: Buffer[] = [];

  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  // Header
  if (template?.template.header.logo) {
    // Add logo (would load from storage)
  }

  doc.fontSize(20).text(template?.template.header.companyName || invoice.from.name, { align: 'left' });
  doc.fontSize(10).text(template?.template.header.address || invoice.from.address);
  doc.moveDown();

  // Invoice details
  doc.fontSize(16).text('INVOICE', { align: 'right' });
  doc.fontSize(10).text(`Invoice #: ${invoice.invoiceNumber}`, { align: 'right' });
  doc.text(`Issue Date: ${invoice.issueDate.toLocaleDateString()}`, { align: 'right' });
  doc.text(`Due Date: ${invoice.dueDate.toLocaleDateString()}`, { align: 'right' });
  doc.moveDown();

  // Bill to
  doc.fontSize(12).text('Bill To:', { underline: true });
  doc.fontSize(10).text(invoice.to.name);
  doc.text(invoice.to.address);
  if (invoice.to.vatNumber) {
    doc.text(`VAT: ${invoice.to.vatNumber}`);
  }
  doc.moveDown();

  // Line items table
  doc.fontSize(10);
  doc.text('Description', 50, doc.y);
  doc.text('Qty', 300, doc.y);
  doc.text('Price', 350, doc.y);
  doc.text('Tax', 420, doc.y);
  doc.text('Total', 480, doc.y, { align: 'right' });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(0.5);

  for (const item of invoice.lineItems) {
    doc.text(item.description, 50);
    doc.text(String(item.quantity), 300);
    doc.text(`£${item.unitPrice.toFixed(2)}`, 350);
    doc.text(`${(item.taxRate * 100).toFixed(0)}%`, 420);
    doc.text(`£${item.total.toFixed(2)}`, 480, doc.y, { align: 'right' });
    doc.moveDown();
  }

  doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown();

  // Totals
  doc.text('Subtotal:', 400, doc.y, { align: 'right' });
  doc.text(`£${invoice.subtotal.toFixed(2)}`, 480, doc.y, { align: 'right' });
  doc.moveDown();
  doc.text('VAT:', 400, doc.y, { align: 'right' });
  doc.text(`£${invoice.tax.toFixed(2)}`, 480, doc.y, { align: 'right' });
  doc.moveDown();
  doc.fontSize(12).font('Helvetica-Bold');
  doc.text('Total:', 400, doc.y, { align: 'right' });
  doc.text(`£${invoice.total.toFixed(2)}`, 480, doc.y, { align: 'right' });
  doc.moveDown(2);

  // Footer
  doc.fontSize(8).font('Helvetica');
  doc.text(template?.template.footer.paymentTerms || `Payment due within 30 days.`, { align: 'center' });
  doc.text(template?.template.footer.terms || '', { align: 'center' });

  doc.end();

  // Wait for PDF to complete
  await new Promise<void>((resolve) => {
    doc.on('end', resolve);
    setTimeout(resolve, 2000);
  });

  return Buffer.concat(chunks);
}

/**
 * Create invoice template
 */
export async function createInvoiceTemplate(
  tenantId: TenantId,
  template: Omit<InvoiceTemplate, 'id'>
): Promise<string> {
  const templateId = crypto.randomUUID();

  await db.query(
    `INSERT INTO invoice_templates (
      id, tenant_id, name, template, created_at, updated_at
    ) VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())`,
    [templateId, tenantId, template.name, JSON.stringify(template.template)]
  );

  logger.info('Invoice template created', { templateId, tenantId });
  return templateId;
}
