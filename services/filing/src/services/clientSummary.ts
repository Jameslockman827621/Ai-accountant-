import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';
import { filingReadinessService } from './filingReadiness';
import { buildVarianceSummary } from './varianceAnalysis';

export interface ClientSummary {
  headline: string;
  readinessScore: number;
  changes: string[];
  nextSteps: string[];
  period: { start: string; end: string };
}

export async function generateClientSummary(
  filingId: string,
  tenantId: TenantId
): Promise<ClientSummary> {
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
  const readiness =
    (await filingReadinessService.getReadiness(filingId)) ||
    (await filingReadinessService.calculateReadiness(filingId, tenantId));
  const variance =
    (await buildVarianceSummary(filingId, tenantId, filing.filing_type, filing.filing_data || {})) || undefined;

  const changes: string[] = [];
  if (variance?.periodChange) {
    changes.push(
      `Revenue moved ${Math.round((variance.periodChange || 0) * 100)}% versus the previous filing.`
    );
  }
  if (variance?.taxChange) {
    changes.push(
      `Tax liability shifted ${Math.round((variance.taxChange || 0) * 100)}% compared to last period.`
    );
  }
  if (readiness.details.missingData.length > 0) {
    changes.push(`Missing data detected: ${readiness.details.missingData.join(', ')}.`);
  }

  const nextSteps: string[] = [];
  if (readiness.details.unmatchedTransactions > 0) {
    nextSteps.push(`${readiness.details.unmatchedTransactions} bank transactions need reconciliation.`);
  }
  if (readiness.details.unhealthyConnectors.length > 0) {
    nextSteps.push(`Reconnect: ${readiness.details.unhealthyConnectors.join(', ')}.`);
  }
  if ((readiness.details.variance?.insights || []).length > 0) {
    nextSteps.push(...(readiness.details.variance?.insights || []));
  }

  const headline =
    readiness.overall >= 90
      ? '✅ Filing is ready for submission once final approvals are complete.'
      : '⚠️ Filing requires attention before it can be submitted.';

  const summary: ClientSummary = {
    headline,
    readinessScore: readiness.overall,
    changes,
    nextSteps,
    period: {
      start: filing.period_start.toISOString().split('T')[0],
      end: filing.period_end.toISOString().split('T')[0],
    },
  };

  await db.query(
    `UPDATE filings
        SET filing_data = jsonb_set(
              COALESCE(filing_data, '{}'::jsonb),
              '{clientSummary}',
              $2::jsonb,
              true
            ),
            updated_at = NOW()
      WHERE id = $1`,
    [filingId, JSON.stringify(summary)]
  );

  return summary;
}
