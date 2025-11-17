import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('reconciliation-exceptions');

export type ExceptionType =
  | 'unmatched'
  | 'duplicate'
  | 'missing_document'
  | 'amount_mismatch'
  | 'date_mismatch'
  | 'unusual_spend'
  | 'anomaly';

export type ExceptionSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ReconciliationException {
  id: string;
  tenantId: TenantId;
  exceptionType: ExceptionType;
  severity: ExceptionSeverity;
  bankTransactionId?: string;
  documentId?: string;
  ledgerEntryId?: string;
  description: string;
  anomalyScore?: number;
  remediationPlaybook?: Array<{
    step: number;
    action: string;
    description: string;
  }>;
  assignedTo?: UserId;
  status: 'open' | 'in_progress' | 'resolved' | 'dismissed';
  resolvedAt?: Date;
  resolvedBy?: UserId;
  resolutionNotes?: string;
  createdAt: Date;
}

export class ReconciliationExceptionService {
  /**
   * Create reconciliation exception
   */
  async createException(
    tenantId: TenantId,
    exception: {
      exceptionType: ExceptionType;
      severity?: ExceptionSeverity;
      bankTransactionId?: string;
      documentId?: string;
      ledgerEntryId?: string;
      description: string;
      anomalyScore?: number;
      remediationPlaybook?: Array<{ step: number; action: string; description: string }>;
    }
  ): Promise<string> {
    const exceptionId = randomUUID();

    // Determine severity if not provided
    const severity = exception.severity || this.determineSeverity(exception.exceptionType, exception.anomalyScore);

    // Generate remediation playbook if not provided
    const playbook = exception.remediationPlaybook || this.generatePlaybook(exception.exceptionType);

    await db.query(
      `INSERT INTO reconciliation_exceptions (
        id, tenant_id, exception_type, severity, bank_transaction_id,
        document_id, ledger_entry_id, description, anomaly_score,
        remediation_playbook, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, NOW(), NOW())`,
      [
        exceptionId,
        tenantId,
        exception.exceptionType,
        severity,
        exception.bankTransactionId || null,
        exception.documentId || null,
        exception.ledgerEntryId || null,
        exception.description,
        exception.anomalyScore || null,
        JSON.stringify(playbook),
        'open',
      ]
    );

    logger.info('Reconciliation exception created', {
      exceptionId,
      tenantId,
      exceptionType: exception.exceptionType,
      severity,
    });

    return exceptionId;
  }

  /**
   * Get exceptions for tenant
   */
  async getExceptions(
    tenantId: TenantId,
    options?: {
      status?: ReconciliationException['status'];
      severity?: ExceptionSeverity;
      exceptionType?: ExceptionType;
      assignedTo?: UserId;
      limit?: number;
    }
  ): Promise<ReconciliationException[]> {
    let query = `
      SELECT id, tenant_id, exception_type, severity, bank_transaction_id,
             document_id, ledger_entry_id, description, anomaly_score,
             remediation_playbook, assigned_to, status, resolved_at,
             resolved_by, resolution_notes, created_at
      FROM reconciliation_exceptions
      WHERE tenant_id = $1
    `;
    const params: unknown[] = [tenantId];
    let paramCount = 2;

    if (options?.status) {
      query += ` AND status = $${paramCount++}`;
      params.push(options.status);
    }

    if (options?.severity) {
      query += ` AND severity = $${paramCount++}`;
      params.push(options.severity);
    }

    if (options?.exceptionType) {
      query += ` AND exception_type = $${paramCount++}`;
      params.push(options.exceptionType);
    }

    if (options?.assignedTo) {
      query += ` AND assigned_to = $${paramCount++}`;
      params.push(options.assignedTo);
    }

    query += ` ORDER BY
      CASE severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
      END,
      created_at DESC`;

    if (options?.limit) {
      query += ` LIMIT $${paramCount++}`;
      params.push(options.limit);
    }

    const result = await db.query<{
      id: string;
      tenant_id: string;
      exception_type: string;
      severity: string;
      bank_transaction_id: string | null;
      document_id: string | null;
      ledger_entry_id: string | null;
      description: string;
      anomaly_score: number | null;
      remediation_playbook: unknown;
      assigned_to: string | null;
      status: string;
      resolved_at: Date | null;
      resolved_by: string | null;
      resolution_notes: string | null;
      created_at: Date;
    }>(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id as TenantId,
      exceptionType: row.exception_type as ExceptionType,
      severity: row.severity as ExceptionSeverity,
      bankTransactionId: row.bank_transaction_id || undefined,
      documentId: row.document_id || undefined,
      ledgerEntryId: row.ledger_entry_id || undefined,
      description: row.description,
      anomalyScore: row.anomaly_score ? parseFloat(row.anomaly_score.toString()) : undefined,
      remediationPlaybook: (row.remediation_playbook as ReconciliationException['remediationPlaybook']) || undefined,
      assignedTo: row.assigned_to as UserId | undefined,
      status: row.status as ReconciliationException['status'],
      resolvedAt: row.resolved_at || undefined,
      resolvedBy: row.resolved_by as UserId | undefined,
      resolutionNotes: row.resolution_notes || undefined,
      createdAt: row.created_at,
    }));
  }

  /**
   * Resolve exception
   */
  async resolveException(
    exceptionId: string,
    tenantId: TenantId,
    resolvedBy: UserId,
    resolutionNotes?: string
  ): Promise<void> {
    await db.query(
      `UPDATE reconciliation_exceptions
       SET status = 'resolved',
           resolved_at = NOW(),
           resolved_by = $1,
           resolution_notes = $2,
           updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4`,
      [resolvedBy, resolutionNotes || null, exceptionId, tenantId]
    );

    logger.info('Exception resolved', { exceptionId, resolvedBy });
  }

  /**
   * Assign exception
   */
  async assignException(exceptionId: string, tenantId: TenantId, assignedTo: UserId): Promise<void> {
    await db.query(
      `UPDATE reconciliation_exceptions
       SET assigned_to = $1, status = 'in_progress', updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [assignedTo, exceptionId, tenantId]
    );

    logger.info('Exception assigned', { exceptionId, assignedTo });
  }

  /**
   * Determine severity based on type and anomaly score
   */
  private determineSeverity(exceptionType: ExceptionType, anomalyScore?: number): ExceptionSeverity {
    if (anomalyScore && anomalyScore > 0.9) return 'critical';
    if (anomalyScore && anomalyScore > 0.7) return 'high';

    switch (exceptionType) {
      case 'unmatched':
        return 'medium';
      case 'duplicate':
        return 'high';
      case 'missing_document':
        return 'medium';
      case 'amount_mismatch':
        return 'high';
      case 'unusual_spend':
        return anomalyScore && anomalyScore > 0.8 ? 'critical' : 'high';
      case 'anomaly':
        return 'high';
      default:
        return 'medium';
    }
  }

  /**
   * Generate remediation playbook
   */
  private generatePlaybook(exceptionType: ExceptionType): Array<{
    step: number;
    action: string;
    description: string;
  }> {
    const playbooks: Record<ExceptionType, Array<{ step: number; action: string; description: string }>> = {
      unmatched: [
        { step: 1, action: 'review_transaction', description: 'Review transaction details and description' },
        { step: 2, action: 'search_documents', description: 'Search for related documents or receipts' },
        { step: 3, action: 'check_ledger', description: 'Check if entry exists in ledger with different amount/date' },
        { step: 4, action: 'manual_match', description: 'Manually match if found, or create exception note' },
      ],
      duplicate: [
        { step: 1, action: 'identify_duplicate', description: 'Identify which transaction is the duplicate' },
        { step: 2, action: 'verify_source', description: 'Verify source of each transaction' },
        { step: 3, action: 'remove_duplicate', description: 'Remove or void the duplicate entry' },
      ],
      missing_document: [
        { step: 1, action: 'request_document', description: 'Request missing document from vendor or employee' },
        { step: 2, action: 'temporary_note', description: 'Add temporary note explaining missing document' },
        { step: 3, action: 'follow_up', description: 'Set follow-up reminder to obtain document' },
      ],
      amount_mismatch: [
        { step: 1, action: 'verify_amounts', description: 'Verify amounts in bank, document, and ledger' },
        { step: 2, action: 'check_fees', description: 'Check for bank fees or currency conversion differences' },
        { step: 3, action: 'adjust_entry', description: 'Create adjusting entry if necessary' },
      ],
      date_mismatch: [
        { step: 1, action: 'verify_dates', description: 'Verify transaction dates across all sources' },
        { step: 2, action: 'check_clearing', description: 'Check if date difference is due to clearing time' },
        { step: 3, action: 'adjust_date', description: 'Adjust date if necessary or note the difference' },
      ],
      unusual_spend: [
        { step: 1, action: 'review_amount', description: 'Review transaction amount and compare to historical patterns' },
        { step: 2, action: 'verify_authorization', description: 'Verify transaction was properly authorized' },
        { step: 3, action: 'check_budget', description: 'Check if transaction exceeds budget thresholds' },
        { step: 4, action: 'escalate', description: 'Escalate to manager if amount is unusually high' },
      ],
      anomaly: [
        { step: 1, action: 'analyze_pattern', description: 'Analyze transaction pattern and context' },
        { step: 2, action: 'compare_historical', description: 'Compare to historical similar transactions' },
        { step: 3, action: 'investigate', description: 'Investigate root cause of anomaly' },
        { step: 4, action: 'document_finding', description: 'Document findings and resolution' },
      ],
    };

    return playbooks[exceptionType] || [];
  }
}

export const reconciliationExceptionService = new ReconciliationExceptionService();
