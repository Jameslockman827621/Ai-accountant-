import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { unifiedIngestionService } from '../../ingestion/src/services/unifiedIngestion';

const logger = createLogger('email-ingestion');

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  body: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    content: Buffer;
  }>;
  headers: Record<string, string>;
}

export class EmailIngestionService {
  /**
   * Process incoming email
   */
  async processEmail(tenantId: TenantId, email: EmailMessage): Promise<string> {
    const emailHash = this.createEmailHash(email);

    // Check for duplicates
    const duplicate = await this.checkDuplicate(tenantId, emailHash);
    if (duplicate) {
      logger.warn('Duplicate email detected', { tenantId, emailHash, duplicate });
      throw new Error('Duplicate email');
    }

    // Check if email is spam or non-financial
    const isSpam = await this.isSpam(email);
    if (isSpam) {
      logger.info('Email filtered as spam', { tenantId, from: email.from, subject: email.subject });
      return 'filtered';
    }

    // Extract financial documents from attachments
    const documents = await this.extractDocuments(tenantId, email);

    // Log ingestion
    const ingestionLogId = await unifiedIngestionService.logIngestion(tenantId, 'system' as any, {
      sourceType: 'email',
      payload: {
        from: email.from,
        to: email.to,
        subject: email.subject,
        body: email.body.substring(0, 1000), // First 1000 chars
        attachmentCount: email.attachments?.length || 0,
        documentIds: documents.map(d => d.id),
      },
      metadata: {
        emailHash,
        headers: email.headers,
      },
    });

    // Process each document
    for (const doc of documents) {
      await this.processDocument(tenantId, doc, ingestionLogId);
    }

    logger.info('Email processed', { tenantId, ingestionLogId, documentCount: documents.length });

    return ingestionLogId;
  }

  /**
   * Extract documents from email attachments
   */
  private async extractDocuments(tenantId: TenantId, email: EmailMessage): Promise<Array<{ id: string; type: string; filename: string }>> {
    const documents: Array<{ id: string; type: string; filename: string }> = [];

    if (!email.attachments || email.attachments.length === 0) {
      return documents;
    }

    for (const attachment of email.attachments) {
      // Check if attachment is a financial document
      const isFinancialDoc = this.isFinancialDocument(attachment.filename, attachment.contentType);
      if (!isFinancialDoc) {
        continue;
      }

      // Create document record
      const documentId = randomUUID();
      const storageKey = `emails/${tenantId}/${documentId}/${attachment.filename}`;

      // Store document in S3 (in production)
      // await s3.putObject({ Bucket: bucket, Key: storageKey, Body: attachment.content });

      // Create document record in database
      await db.query(
        `INSERT INTO documents (
          id, tenant_id, uploaded_by, file_name, file_type, file_size,
          storage_key, status, upload_source, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [
          documentId,
          tenantId,
          'system', // Email ingestion
          attachment.filename,
          attachment.contentType,
          attachment.content.length,
          storageKey,
          'uploaded',
          'email',
        ]
      );

      documents.push({
        id: documentId,
        type: this.detectDocumentType(attachment.filename, attachment.contentType),
        filename: attachment.filename,
      });
    }

    return documents;
  }

  /**
   * Process document (queue for OCR and classification)
   */
  private async processDocument(tenantId: TenantId, doc: { id: string; type: string }, ingestionLogId: string): Promise<void> {
    // Queue for OCR processing
    // In production, would publish to RabbitMQ
    logger.info('Document queued for processing', {
      tenantId,
      documentId: doc.id,
      type: doc.type,
      ingestionLogId,
    });
  }

  /**
   * Check if email is spam
   */
  private async isSpam(email: EmailMessage): Promise<boolean> {
    // Simple spam detection - in production would use ML model
    const spamKeywords = ['promo', 'discount', 'sale', 'click here', 'unsubscribe'];
    const subjectLower = email.subject.toLowerCase();
    const bodyLower = email.body.toLowerCase();

    // Check for spam keywords
    for (const keyword of spamKeywords) {
      if (subjectLower.includes(keyword) || bodyLower.includes(keyword)) {
        return true;
      }
    }

    // Check if email has financial attachments
    if (!email.attachments || email.attachments.length === 0) {
      return true; // No attachments = likely not financial
    }

    // Check if any attachment is a financial document
    const hasFinancialDoc = email.attachments.some(att =>
      this.isFinancialDocument(att.filename, att.contentType)
    );

    return !hasFinancialDoc;
  }

  /**
   * Check if attachment is a financial document
   */
  private isFinancialDocument(filename: string, contentType: string): boolean {
    const financialExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.xls', '.csv'];
    const financialContentTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ];

    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return (
      financialExtensions.includes(ext) ||
      financialContentTypes.includes(contentType.toLowerCase())
    );
  }

  /**
   * Detect document type from filename
   */
  private detectDocumentType(filename: string, contentType: string): string {
    const filenameLower = filename.toLowerCase();

    if (filenameLower.includes('invoice') || filenameLower.includes('inv')) {
      return 'invoice';
    }
    if (filenameLower.includes('receipt')) {
      return 'receipt';
    }
    if (filenameLower.includes('statement')) {
      return 'statement';
    }
    if (filenameLower.includes('payslip') || filenameLower.includes('payroll')) {
      return 'payslip';
    }

    return 'other';
  }

  /**
   * Create hash for email deduplication
   */
  private createEmailHash(email: EmailMessage): string {
    const hashInput = `${email.from}:${email.subject}:${email.body.substring(0, 500)}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Check for duplicate email
   */
  private async checkDuplicate(tenantId: TenantId, emailHash: string): Promise<string | null> {
    const result = await db.query<{ id: string }>(
      `SELECT id FROM ingestion_log
       WHERE tenant_id = $1
         AND source_type = 'email'
         AND metadata->>'emailHash' = $2
       LIMIT 1`,
      [tenantId, emailHash]
    );

    return result.rows.length > 0 ? result.rows[0].id : null;
  }
}

export const emailIngestionService = new EmailIngestionService();
