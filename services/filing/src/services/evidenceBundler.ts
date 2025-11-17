import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';
import { createLogger } from '@ai-accountant/shared-utils';
import { randomUUID, createHash } from 'crypto';
import PDFDocument from 'pdfkit';
import JSZip from 'jszip';
import { storeEvidenceBundle } from '../storage/evidenceStorage';

const logger = createLogger('evidence-bundler');

interface EvidenceBundleMetadata {
  id: string;
  storageKey: string;
  createdAt: string;
  checksum: string;
  contentLength: number;
}

class EvidenceBundlerService {
  async generateBundle(filingId: string, tenantId: TenantId): Promise<EvidenceBundleMetadata> {
    const filingResult = await db.query<{
      filing_type: string;
      period_start: Date;
      period_end: Date;
      filing_data: Record<string, unknown>;
    }>(
      `SELECT filing_type, period_start, period_end, filing_data
         FROM filings
        WHERE id = $1 AND tenant_id = $2`,
      [filingId, tenantId]
    );

    if (filingResult.rows.length === 0) {
      throw new Error('Filing not found');
    }

    const filing = filingResult.rows[0];
    const supportingDocuments = await this.fetchDocuments(tenantId, filing.period_start, filing.period_end);
    const ledgerEntries = await this.fetchLedger(tenantId, filing.period_start, filing.period_end);

    const zip = new JSZip();
    zip.file('metadata.json', JSON.stringify(filing.filing_data ?? {}, null, 2));
    zip.file('documents.json', JSON.stringify(supportingDocuments, null, 2));
    zip.file('ledger.csv', this.buildLedgerCsv(ledgerEntries));
    zip.file('summary.pdf', await this.buildPdfSummary(filing, supportingDocuments, ledgerEntries));

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const storageKey = await storeEvidenceBundle({
      tenantId,
      filingId,
      buffer,
      contentType: 'application/zip',
    });

    const metadata: EvidenceBundleMetadata = {
      id: randomUUID(),
      storageKey,
      createdAt: new Date().toISOString(),
      checksum: createHash('sha256').update(buffer).digest('hex'),
      contentLength: buffer.length,
    };

    await this.persistMetadata(filingId, metadata);

    logger.info('Filing evidence bundle generated', { filingId, storageKey });
    return metadata;
  }

  private async fetchDocuments(tenantId: TenantId, start: Date, end: Date) {
    const result = await db.query<{
      id: string;
      file_name: string;
      total_amount: number | null;
      tax_amount: number | null;
      document_type: string;
    }>(
      `SELECT id, file_name, total_amount, tax_amount, document_type
         FROM documents
        WHERE tenant_id = $1
          AND document_date BETWEEN $2 AND $3`,
      [tenantId, start, end]
    );
    return result.rows;
  }

  private async fetchLedger(tenantId: TenantId, start: Date, end: Date) {
    const result = await db.query<{
      transaction_date: Date;
      account_code: string;
      debit: number | null;
      credit: number | null;
      description: string | null;
    }>(
      `SELECT transaction_date, account_code, debit, credit, description
         FROM ledger_entries
        WHERE tenant_id = $1
          AND transaction_date BETWEEN $2 AND $3
        ORDER BY transaction_date`,
      [tenantId, start, end]
    );
    return result.rows;
  }

  private buildLedgerCsv(rows: Array<Record<string, unknown>>): string {
    const header = 'transaction_date,account_code,debit,credit,description';
    const lines = rows.map(row =>
      [
        row.transaction_date instanceof Date ? row.transaction_date.toISOString().split('T')[0] : '',
        row.account_code,
        row.debit ?? '',
        row.credit ?? '',
        `"${(row.description as string | undefined)?.replace(/"/g, '""') ?? ''}"`,
      ].join(',')
    );
    return [header, ...lines].join('\n');
  }

  private async buildPdfSummary(
    filing: {
      filing_type: string;
      period_start: Date;
      period_end: Date;
      filing_data: Record<string, unknown>;
    },
    documents: Array<Record<string, unknown>>,
    ledgerEntries: Array<Record<string, unknown>>
  ): Promise<Buffer> {
    return new Promise(resolve => {
      const doc = new PDFDocument();
      const chunks: Buffer[] = [];
      doc.on('data', chunk => chunks.push(chunk as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      doc.fontSize(18).text('Filing Evidence Bundle', { underline: true });
      doc.moveDown();
      doc.fontSize(12).text(`Filing type: ${filing.filing_type.toUpperCase()}`);
      doc.text(
        `Period: ${filing.period_start.toISOString().split('T')[0]} - ${filing.period_end
          .toISOString()
          .split('T')[0]}`
      );
      doc.moveDown();
      doc.text('Key Totals');
      doc.list(
        [
          `Total sales: ${numberFromPath(filing.filing_data, ['totalSales']) ?? 'n/a'}`,
          `Total purchases: ${numberFromPath(filing.filing_data, ['totalPurchases']) ?? 'n/a'}`,
          `Net tax: ${numberFromPath(filing.filing_data, ['netVAT']) ?? numberFromPath(filing.filing_data, ['corporationTax']) ?? 'n/a'}`,
        ],
        { bulletRadius: 2 }
      );
      doc.moveDown();
      doc.text(`Supporting documents attached: ${documents.length}`);
      doc.text(`Ledger entries attached: ${ledgerEntries.length}`);
      doc.end();
    });
  }

  private async persistMetadata(filingId: string, metadata: EvidenceBundleMetadata): Promise<void> {
    await db.query(
      `UPDATE filings
          SET filing_data = jsonb_set(
                COALESCE(filing_data, '{}'::jsonb),
                '{evidenceBundles}',
                COALESCE(filing_data -> 'evidenceBundles', '[]'::jsonb) || $2::jsonb,
                true
              ),
              updated_at = NOW()
        WHERE id = $1`,
      [filingId, JSON.stringify(metadata)]
    );
  }
}

function numberFromPath(payload: Record<string, unknown>, path: string[]): number | undefined {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current === 'number') {
    return current;
  }
  if (typeof current === 'string') {
    const parsed = parseFloat(current);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

export const evidenceBundlerService = new EvidenceBundlerService();
