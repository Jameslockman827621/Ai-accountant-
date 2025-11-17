import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';
import { createLogger } from '@ai-accountant/shared-utils';
import { buildVarianceSummary, VarianceSummary } from './varianceAnalysis';

const logger = createLogger('filing-readiness');

export interface FilingReadinessSnapshot {
  overall: number;
  dataCompleteness: number;
  reconciliation: number;
  connectorHealth: number;
  taskCompletion: number;
  details: {
    missingData: string[];
    unmatchedTransactions: number;
    unhealthyConnectors: string[];
    pendingTasks: number;
    variance?: VarianceSummary | null;
  };
}

class FilingReadinessService {
  async calculateReadiness(filingId: string, tenantId: TenantId): Promise<FilingReadinessSnapshot> {
    const filingResult = await db.query<{
      filing_type: string;
      period_start: Date;
      period_end: Date;
      filing_data: Record<string, unknown> | null;
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
    const details: FilingReadinessSnapshot['details'] = {
      missingData: [],
      unmatchedTransactions: 0,
      unhealthyConnectors: [],
      pendingTasks: 0,
      variance: null,
    };

    const dataCompleteness = await this.calculateDataCompleteness(
      tenantId,
      filing.period_start,
      filing.period_end,
      details
    );
    const reconciliation = await this.calculateReconciliation(
      tenantId,
      filing.period_start,
      filing.period_end,
      details
    );
    const connectorHealth = await this.calculateConnectorHealth(tenantId, details);
    const taskCompletion = await this.calculateTaskCompletion(tenantId, details);
    const variance = await buildVarianceSummary(
      filingId,
      tenantId,
      filing.filing_type,
      filing.filing_data || {}
    );
    details.variance = variance;

    const varianceScore = variance?.confidence ?? 85;
    const overall = Math.round(
      dataCompleteness * 0.35 +
        reconciliation * 0.3 +
        connectorHealth * 0.2 +
        taskCompletion * 0.1 +
        varianceScore * 0.05
    );

    const snapshot: FilingReadinessSnapshot = {
      overall: Math.min(100, overall),
      dataCompleteness,
      reconciliation,
      connectorHealth,
      taskCompletion,
      details,
    };

    await this.persistReadiness(filingId, snapshot);
    return snapshot;
  }

  async getReadiness(filingId: string): Promise<FilingReadinessSnapshot | null> {
    const result = await db.query<{
      readiness: FilingReadinessSnapshot | null;
    }>(
      `SELECT filing_data -> 'readiness' as readiness
         FROM filings
        WHERE id = $1`,
      [filingId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return (result.rows[0].readiness as FilingReadinessSnapshot | null) || null;
  }

  private async calculateDataCompleteness(
    tenantId: TenantId,
    periodStart: Date,
    periodEnd: Date,
    details: FilingReadinessSnapshot['details']
  ): Promise<number> {
    const documents = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
         FROM documents
        WHERE tenant_id = $1
          AND document_date BETWEEN $2 AND $3`,
      [tenantId, periodStart, periodEnd]
    );

    const ledgerEntries = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
         FROM ledger_entries
        WHERE tenant_id = $1
          AND transaction_date BETWEEN $2 AND $3`,
      [tenantId, periodStart, periodEnd]
    );

    const docCount = parseInt(documents.rows[0]?.count ?? '0', 10);
    const ledgerCount = parseInt(ledgerEntries.rows[0]?.count ?? '0', 10);

    if (docCount === 0) {
      details.missingData.push('documents');
    }
    if (ledgerCount === 0) {
      details.missingData.push('ledger_entries');
    }

    if (docCount > 0 && ledgerCount > 0) {
      return 100;
    }
    if (docCount > 0 || ledgerCount > 0) {
      return 60;
    }
    return 20;
  }

  private async calculateReconciliation(
    tenantId: TenantId,
    periodStart: Date,
    periodEnd: Date,
    details: FilingReadinessSnapshot['details']
  ): Promise<number> {
    const unmatchedResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
         FROM bank_transactions
        WHERE tenant_id = $1
          AND transaction_date BETWEEN $2 AND $3
          AND reconciled = false`,
      [tenantId, periodStart, periodEnd]
    );

    const totalResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
         FROM bank_transactions
        WHERE tenant_id = $1
          AND transaction_date BETWEEN $2 AND $3`,
      [tenantId, periodStart, periodEnd]
    );

    const unmatched = parseInt(unmatchedResult.rows[0]?.count ?? '0', 10);
    const total = parseInt(totalResult.rows[0]?.count ?? '0', 10);

    details.unmatchedTransactions = unmatched;

    if (total === 0) {
      return 100;
    }

    const rate = Math.max(0, Math.min(100, Math.round(((total - unmatched) / total) * 100)));
    return rate;
  }

  private async calculateConnectorHealth(
    tenantId: TenantId,
    details: FilingReadinessSnapshot['details']
  ): Promise<number> {
    const connectors = await db.query<{
      provider: string;
      status: string;
      last_sync_status: string | null;
    }>(
      `SELECT provider, status, last_sync_status
         FROM connector_registry
        WHERE tenant_id = $1
          AND is_enabled = true`,
      [tenantId]
    );

    if (connectors.rows.length === 0) {
      return 100;
    }

    let healthy = 0;
    for (const connector of connectors.rows) {
      if (connector.status === 'enabled' && connector.last_sync_status === 'success') {
        healthy += 1;
      } else {
        details.unhealthyConnectors.push(connector.provider);
      }
    }

    return Math.round((healthy / connectors.rows.length) * 100);
  }

  private async calculateTaskCompletion(
    tenantId: TenantId,
    details: FilingReadinessSnapshot['details']
  ): Promise<number> {
    const tasksResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
         FROM exception_queue
        WHERE tenant_id = $1
          AND status = 'open'`,
      [tenantId]
    );

    const pending = parseInt(tasksResult.rows[0]?.count ?? '0', 10);
    details.pendingTasks = pending;

    return Math.max(0, 100 - pending * 12);
  }

  private async persistReadiness(
    filingId: string,
    readiness: FilingReadinessSnapshot
  ): Promise<void> {
    await db.query(
      `UPDATE filings
          SET filing_data = jsonb_set(
                COALESCE(filing_data, '{}'::jsonb),
                '{readiness}',
                $2::jsonb,
                true
              ),
              updated_at = NOW()
        WHERE id = $1`,
      [filingId, JSON.stringify(readiness)]
    );

    logger.info('Updated filing readiness snapshot', {
      filingId,
      overall: readiness.overall,
    });
  }
}

export const filingReadinessService = new FilingReadinessService();
