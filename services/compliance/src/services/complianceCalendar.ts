import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';
import { filingLifecycleService } from '../../../filing/src/services/filingLifecycle';

export interface ComplianceObligation {
  id: string;
  obligationType: 'filing' | 'payment' | 'deadline';
  jurisdiction: string;
  filingType?: string;
  dueDate: string;
  periodStart?: string;
  periodEnd?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'missed' | 'waived';
  filingId?: string;
  readinessScore: number;
  readinessDetails: {
    dataCompleteness: number;
    reconciliationStatus: string;
    connectorHealth: Record<string, string>;
    outstandingTasks: string[];
  };
}

export interface ReadinessScore {
  overall: number;
  dataCompleteness: number;
  reconciliationStatus: number;
  connectorHealth: number;
  taskCompletion: number;
  details: {
    missingData: string[];
    unmatchedTransactions: number;
    unhealthyConnectors: string[];
    pendingTasks: number;
  };
}

type CalendarRow = {
  id: string;
  obligation_type: string;
  jurisdiction: string;
  filing_type: string | null;
  due_date: string;
  period_start: string | null;
  period_end: string | null;
  status: string;
  filing_id: string | null;
  readiness_score: number | null;
  readiness_details: unknown;
};

const defaultReadinessDetails: ComplianceObligation['readinessDetails'] = {
  dataCompleteness: 0,
  reconciliationStatus: 'unknown',
  connectorHealth: {},
  outstandingTasks: [],
};

function mapCalendarRowToObligation(row: CalendarRow): ComplianceObligation {
  const readinessDetails =
    (row.readiness_details as ComplianceObligation['readinessDetails']) ?? defaultReadinessDetails;

  const obligation: ComplianceObligation = {
    id: row.id,
    obligationType: row.obligation_type as ComplianceObligation['obligationType'],
    jurisdiction: row.jurisdiction,
    dueDate: row.due_date,
    status: row.status as ComplianceObligation['status'],
    readinessScore: row.readiness_score ?? 0,
    readinessDetails,
  };

  if (row.filing_type) {
    obligation.filingType = row.filing_type;
  }
  if (row.period_start) {
    obligation.periodStart = row.period_start;
  }
  if (row.period_end) {
    obligation.periodEnd = row.period_end;
  }
  if (row.filing_id) {
    obligation.filingId = row.filing_id;
  }

  return obligation;
}

export class ComplianceCalendarService {
  /**
   * Generate compliance calendar for tenant
   */
  async generateCalendar(
    tenantId: TenantId,
    startDate: string,
    endDate: string
  ): Promise<ComplianceObligation[]> {
    // Discover obligations
    const obligations = await filingLifecycleService.discoverObligations(
      tenantId,
      startDate,
      endDate
    );

    // Create or update calendar entries
    const calendarEntries: ComplianceObligation[] = [];

    for (const obligation of obligations) {
      // Check if entry exists
      const existingResult = await db.query<{ id: string; filing_id: string | null }>(
        `SELECT id, filing_id
         FROM compliance_calendar
         WHERE tenant_id = $1
           AND filing_type = $2
           AND period_start = $3
           AND period_end = $4
         LIMIT 1`,
        [tenantId, obligation.filingType, obligation.periodStart, obligation.periodEnd]
      );

      let calendarId: string;
      let filingId: string | null = null;

      if (existingResult.rows.length > 0 && existingResult.rows[0]) {
        calendarId = existingResult.rows[0].id;
        filingId = existingResult.rows[0].filing_id;
      } else {
        // Calculate readiness
        const readiness = await this.calculateReadiness(tenantId, obligation);

        // Create new entry
        const insertResult = await db.query<{ id: string }>(
          `INSERT INTO compliance_calendar (
            tenant_id, obligation_type, jurisdiction, filing_type,
            due_date, period_start, period_end, status,
            readiness_score, readiness_details
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
          RETURNING id`,
          [
            tenantId,
            'filing',
            obligation.jurisdiction,
            obligation.filingType,
            obligation.dueDate,
            obligation.periodStart,
            obligation.periodEnd,
            filingId ? 'in_progress' : 'pending',
            readiness.overall,
            JSON.stringify(readiness.details),
          ]
        );
        const insertedRow = insertResult.rows[0];
        if (!insertedRow) {
          continue;
        }
        calendarId = insertedRow.id;
      }

      // Get full entry
      const entryResult = await db.query<{
        id: string;
        obligation_type: string;
        jurisdiction: string;
        filing_type: string | null;
        due_date: string;
        period_start: string | null;
        period_end: string | null;
        status: string;
        filing_id: string | null;
        readiness_score: number | null;
        readiness_details: unknown;
      }>(
        `SELECT id, obligation_type, jurisdiction, filing_type, due_date,
                period_start, period_end, status, filing_id,
                readiness_score, readiness_details
         FROM compliance_calendar
         WHERE id = $1`,
        [calendarId]
      );

      const entry = entryResult.rows[0];
      if (!entry) {
        continue;
      }
      calendarEntries.push(mapCalendarRowToObligation(entry));
    }

    return calendarEntries;
  }

  /**
   * Calculate readiness score for obligation
   */
  async calculateReadiness(
    tenantId: TenantId,
    obligation: { filingType: string; periodStart: string; periodEnd: string }
  ): Promise<ReadinessScore> {
    const details = {
      missingData: [] as string[],
      unmatchedTransactions: 0,
      unhealthyConnectors: [] as string[],
      pendingTasks: 0,
    };

    // Check data completeness
    const dataCompleteness = await this.checkDataCompleteness(tenantId, obligation, details);

    // Check reconciliation status
    const reconciliationStatus = await this.checkReconciliationStatus(
      tenantId,
      obligation,
      details
    );

    // Check connector health
    const connectorHealth = await this.checkConnectorHealth(tenantId, details);

    // Check pending tasks
    const taskCompletion = await this.checkTaskCompletion(tenantId, details);

    // Calculate overall score (weighted average)
    const overall = Math.round(
      dataCompleteness * 0.4 +
        reconciliationStatus * 0.3 +
        connectorHealth * 0.2 +
        taskCompletion * 0.1
    );

    return {
      overall,
      dataCompleteness,
      reconciliationStatus,
      connectorHealth,
      taskCompletion,
      details,
    };
  }

  /**
   * Update readiness scores daily
   */
  async updateReadinessScores(tenantId: TenantId): Promise<void> {
    const calendarResult = await db.query<{
      id: string;
      filing_type: string | null;
      period_start: string | null;
      period_end: string | null;
    }>(
      `SELECT id, filing_type, period_start, period_end
       FROM compliance_calendar
       WHERE tenant_id = $1
         AND status IN ('pending', 'in_progress')
         AND due_date >= CURRENT_DATE`,
      [tenantId]
    );

    for (const entry of calendarResult.rows) {
      if (!entry.filing_type || !entry.period_start || !entry.period_end) continue;

      const readiness = await this.calculateReadiness(tenantId, {
        filingType: entry.filing_type,
        periodStart: entry.period_start,
        periodEnd: entry.period_end,
      });

      await db.query(
        `UPDATE compliance_calendar
         SET readiness_score = $1,
             readiness_details = $2::jsonb,
             updated_at = NOW()
         WHERE id = $3`,
        [readiness.overall, JSON.stringify(readiness.details), entry.id]
      );
    }
  }

  /**
   * Get upcoming deadlines
   */
  async getUpcomingDeadlines(
    tenantId: TenantId,
    days: number = 30
  ): Promise<ComplianceObligation[]> {
    const result = await db.query<{
      id: string;
      obligation_type: string;
      jurisdiction: string;
      filing_type: string | null;
      due_date: string;
      period_start: string | null;
      period_end: string | null;
      status: string;
      filing_id: string | null;
      readiness_score: number | null;
      readiness_details: unknown;
    }>(
      `SELECT id, obligation_type, jurisdiction, filing_type, due_date,
              period_start, period_end, status, filing_id,
              readiness_score, readiness_details
       FROM compliance_calendar
       WHERE tenant_id = $1
         AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${days} days'
         AND status IN ('pending', 'in_progress')
       ORDER BY due_date ASC`,
      [tenantId]
    );

    return result.rows.map((entry) => mapCalendarRowToObligation(entry));
  }

  private async checkDataCompleteness(
    tenantId: TenantId,
    obligation: { periodStart: string; periodEnd: string },
    details: ReadinessScore['details']
  ): Promise<number> {
    // Check if we have documents for the period
    const docCount = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM documents
       WHERE tenant_id = $1
         AND document_date >= $2
         AND document_date <= $3`,
      [tenantId, obligation.periodStart, obligation.periodEnd]
    );

    const ledgerCount = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM ledger_entries
       WHERE tenant_id = $1
         AND transaction_date >= $2
         AND transaction_date <= $3`,
      [tenantId, obligation.periodStart, obligation.periodEnd]
    );

    const hasDocuments = parseInt(docCount.rows[0]?.count || '0', 10) > 0;
    const hasLedger = parseInt(ledgerCount.rows[0]?.count || '0', 10) > 0;

    if (!hasDocuments) details.missingData.push('documents');
    if (!hasLedger) details.missingData.push('ledger_entries');

    // Score: 100 if both present, 50 if one, 0 if neither
    return hasDocuments && hasLedger ? 100 : hasDocuments || hasLedger ? 50 : 0;
  }

  private async checkReconciliationStatus(
    tenantId: TenantId,
    obligation: { periodStart: string; periodEnd: string },
    details: ReadinessScore['details']
  ): Promise<number> {
    const unmatchedResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM bank_transactions
       WHERE tenant_id = $1
         AND transaction_date >= $2
         AND transaction_date <= $3
         AND reconciled = false`,
      [tenantId, obligation.periodStart, obligation.periodEnd]
    );

    const totalResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM bank_transactions
       WHERE tenant_id = $1
         AND transaction_date >= $2
         AND transaction_date <= $3`,
      [tenantId, obligation.periodStart, obligation.periodEnd]
    );

    const unmatched = parseInt(unmatchedResult.rows[0]?.count || '0', 10);
    const total = parseInt(totalResult.rows[0]?.count || '0', 10);

    details.unmatchedTransactions = unmatched;

    if (total === 0) return 100; // No transactions to reconcile

    const reconciliationRate = ((total - unmatched) / total) * 100;
    return Math.max(0, Math.min(100, reconciliationRate));
  }

  private async checkConnectorHealth(
    tenantId: TenantId,
    details: ReadinessScore['details']
  ): Promise<number> {
    const connectorsResult = await db.query<{
      provider: string;
      status: string;
      last_sync_status: string | null;
    }>(
      `SELECT cr.provider, cr.status, cs.last_sync_status
       FROM connector_registry cr
       LEFT JOIN connector_sync_schedule cs ON cs.connector_id = cr.id
       WHERE cr.tenant_id = $1
         AND cr.is_enabled = true`,
      [tenantId]
    );

    if (connectorsResult.rows.length === 0) return 100; // No connectors needed

    let healthy = 0;
    for (const connector of connectorsResult.rows) {
      if (connector.status === 'enabled' && connector.last_sync_status === 'success') {
        healthy++;
      } else {
        details.unhealthyConnectors.push(connector.provider);
      }
    }

    return (healthy / connectorsResult.rows.length) * 100;
  }

  private async checkTaskCompletion(
    tenantId: TenantId,
    details: ReadinessScore['details']
  ): Promise<number> {
    const tasksResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM exception_queue
       WHERE tenant_id = $1
         AND status = 'open'`,
      [tenantId]
    );

    const pending = parseInt(tasksResult.rows[0]?.count || '0', 10);
    details.pendingTasks = pending;

    // Score: 100 if no tasks, decreases with more tasks
    return Math.max(0, 100 - pending * 10);
  }
}

export const complianceCalendarService = new ComplianceCalendarService();
