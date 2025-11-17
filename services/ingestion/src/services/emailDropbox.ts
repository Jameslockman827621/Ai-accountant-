import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { unifiedIngestionService } from './unifiedIngestion';
// Note: IMAP and mailparser are optional dependencies
// In production, install: npm install imap mailparser @types/imap @types/mailparser
// For now, using type definitions that can be implemented later
interface ImapConfig {
  user: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
}

interface ParsedMail {
  from?: { text: string };
  to?: { text: string };
  subject?: string;
  date?: Date;
  messageId?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    content: Buffer;
    size: number;
  }>;
  headers: Record<string, string>;
}

const logger = createLogger('email-dropbox');

export interface EmailDropboxConfig {
  tenantId: TenantId;
  emailAddress: string;
  provider: 'imap' | 'ses';
  imapConfig?: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
  };
  sesConfig?: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  isActive: boolean;
}

export class EmailDropboxService {
  private imapConnections: Map<string, any> = new Map(); // Using any for now until IMAP types are available

  /**
   * Create or update email dropbox configuration
   */
  async configureDropbox(config: EmailDropboxConfig): Promise<string> {
    const dropboxId = randomUUID();

    await db.query(
      `INSERT INTO email_dropboxes (
        id, tenant_id, email_address, provider, config, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())
      ON CONFLICT (tenant_id, email_address) 
      DO UPDATE SET 
        provider = EXCLUDED.provider,
        config = EXCLUDED.config,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()`,
      [
        dropboxId,
        config.tenantId,
        config.emailAddress,
        config.provider,
        JSON.stringify({
          imap: config.imapConfig,
          ses: config.sesConfig,
        }),
        config.isActive,
      ]
    );

    if (config.isActive && config.provider === 'imap' && config.imapConfig) {
      await this.startImapListener(config.tenantId, config.emailAddress, config.imapConfig);
    }

    logger.info('Email dropbox configured', {
      dropboxId,
      tenantId: config.tenantId,
      emailAddress: config.emailAddress,
      provider: config.provider,
    });

    return dropboxId;
  }

  /**
   * Start IMAP listener for email dropbox
   */
  private async startImapListener(
    tenantId: TenantId,
    emailAddress: string,
    imapConfig: EmailDropboxConfig['imapConfig']
  ): Promise<void> {
    if (!imapConfig) {
      throw new Error('IMAP config required');
    }

    const connectionKey = `${tenantId}:${emailAddress}`;

    // Close existing connection if any
    if (this.imapConnections.has(connectionKey)) {
      const existing = this.imapConnections.get(connectionKey);
      if (existing) {
        existing.end();
      }
    }

    // In production, would use actual IMAP library
    // const Imap = require('imap');
    // const imap = new Imap({...});
    
    // For now, log that IMAP connection would be established
    logger.info('IMAP connection would be established', {
      tenantId,
      emailAddress,
      host: imapConfig.host,
      port: imapConfig.port,
    });

    // TODO: Implement actual IMAP connection when library is available
    // This is a placeholder that would be replaced with actual IMAP implementation
    // For now, store a placeholder object
    this.imapConnections.set(connectionKey, { connected: true });
  }

  /**
   * Open inbox and listen for new emails
   * TODO: Implement when IMAP library is available
   */
  private async openInbox(imap: any, tenantId: TenantId, emailAddress: string): Promise<void> {
    // Placeholder for IMAP inbox opening
    // In production, would implement actual IMAP operations
    logger.info('IMAP inbox would be opened', { tenantId, emailAddress });
  }

  /**
   * Process incoming email
   */
  private async processEmail(tenantId: TenantId, parsed: ParsedMail): Promise<void> {
    const emailHash = this.createEmailHash(parsed);

    // Check for duplicates
    const duplicate = await this.checkDuplicate(tenantId, emailHash);
    if (duplicate) {
      logger.warn('Duplicate email detected', { tenantId, emailHash });
      return;
    }

    // Create ingestion event
    const traceId = randomUUID();
    const checksum = emailHash;

    await db.query(
      `INSERT INTO ingestion_events (
        id, tenant_id, channel, source_type, checksum, payload_preview,
        trace_id, status, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, NOW(), NOW())`,
      [
        randomUUID(),
        tenantId,
        'email',
        'email_dropbox',
        checksum,
        JSON.stringify({
          from: parsed.from?.text,
          to: parsed.to?.text,
          subject: parsed.subject,
          date: parsed.date,
        }),
        traceId,
        'pending',
        JSON.stringify({
          emailHash,
          messageId: parsed.messageId,
          headers: parsed.headers,
        }),
      ]
    );

    // Process attachments as documents
    if (parsed.attachments && parsed.attachments.length > 0) {
      for (const attachment of parsed.attachments) {
        await this.processAttachment(tenantId, attachment, traceId);
      }
    }

    logger.info('Email processed', { tenantId, traceId, attachmentCount: parsed.attachments?.length || 0 });
  }

  /**
   * Process email attachment
   */
  private async processAttachment(
    tenantId: TenantId,
    attachment: any,
    traceId: string
  ): Promise<void> {
    // Check if attachment is a financial document
    if (!this.isFinancialDocument(attachment.filename || '', attachment.contentType)) {
      return;
    }

    // Log ingestion for document
    await unifiedIngestionService.logIngestion(tenantId, 'system' as any, {
      sourceType: 'email',
      payload: {
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
      },
      metadata: {
        traceId,
        source: 'email_dropbox',
      },
    });
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
      financialContentTypes.includes(contentType?.toLowerCase() || '')
    );
  }

  /**
   * Create email hash for deduplication
   */
  private createEmailHash(parsed: ParsedMail): string {
    const hashInput = `${parsed.from?.text}:${parsed.subject}:${parsed.date?.toISOString()}:${parsed.messageId}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Check for duplicate email
   */
  private async checkDuplicate(tenantId: TenantId, emailHash: string): Promise<string | null> {
    const result = await db.query<{ id: string }>(
      `SELECT id FROM ingestion_events
       WHERE tenant_id = $1 AND checksum = $2
       LIMIT 1`,
      [tenantId, emailHash]
    );

    return result.rows.length > 0 ? result.rows[0].id : null;
  }

  /**
   * Stop IMAP listener
   */
  async stopDropbox(tenantId: TenantId, emailAddress: string): Promise<void> {
    const connectionKey = `${tenantId}:${emailAddress}`;
    const imap = this.imapConnections.get(connectionKey);

    if (imap) {
      imap.end();
      this.imapConnections.delete(connectionKey);
    }

    await db.query(
      `UPDATE email_dropboxes SET is_active = false, updated_at = NOW()
       WHERE tenant_id = $1 AND email_address = $2`,
      [tenantId, emailAddress]
    );

    logger.info('Email dropbox stopped', { tenantId, emailAddress });
  }
}

export const emailDropboxService = new EmailDropboxService();
