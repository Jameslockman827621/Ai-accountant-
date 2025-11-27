import { createLogger } from '@ai-accountant/shared-utils';
import { sendEmail } from './email';

const logger = createLogger('notification-service');

export interface ReconciliationReportEmailPayload {
  tenantName: string;
  recipients: string[];
  report: {
    generatedAt: string;
    rangeDays: number;
    summary: {
      totalTransactions: number;
      reconciledTransactions: number;
      pendingTransactions: number;
      pendingAmount: number;
      autoMatchRate: number;
      ledgerPendingEntries: number;
      lastReconciledAt: string | null;
      openExceptions: number;
      criticalExceptions: number;
      avgTimeToReconcileHours: number | null;
    };
    variances: Array<{
      period: string;
      bankTotal: number;
      ledgerTotal: number;
      variance: number;
      variancePercentage: number;
      unreconciledTransactions: number;
    }>;
    hotspots: Array<{ category: string; severity: string; open: number }>;
  };
}

export async function sendReconciliationSummaryEmail(payload: ReconciliationReportEmailPayload): Promise<void> {
  const { tenantName, recipients, report } = payload;
  const subject = `${tenantName} reconciliation summary (${report.rangeDays}d)`;
  const html = buildHtmlBody(payload);

  for (const recipient of recipients) {
    try {
      await sendEmail(recipient, subject, html);
      logger.info('Reconciliation summary email sent', { tenantName, recipient });
    } catch (error) {
      logger.error('Failed to send reconciliation summary email', error instanceof Error ? error : new Error(String(error)), {
        tenantName,
        recipient,
      });
    }
  }
}

function buildHtmlBody({ tenantName, report }: ReconciliationReportEmailPayload): string {
  const summary = report.summary;
  const varianceRows = report.variances
    .slice(-7)
    .map(
      (v) =>
        `<tr><td>${v.period}</td><td>${v.bankTotal.toFixed(2)}</td><td>${v.ledgerTotal.toFixed(2)}</td><td>${v.variance.toFixed(
          2
        )}</td><td>${v.variancePercentage.toFixed(2)}%</td><td>${v.unreconciledTransactions}</td></tr>`
    )
    .join('');

  const hotspotRows =
    report.hotspots.length > 0
      ? report.hotspots
          .map((h) => `<li>${h.category} (${h.severity}): ${h.open} open</li>`)
          .join('')
      : '<li>No open exceptions</li>';

  return `
    <div style="font-family: Arial, sans-serif;">
      <h2>${tenantName} reconciliation summary</h2>
      <p>Generated at ${new Date(report.generatedAt).toLocaleString()} for the last ${report.rangeDays} days.</p>
      <h3>Snapshot</h3>
      <ul>
        <li>Total transactions: ${summary.totalTransactions}</li>
        <li>Reconciled: ${summary.reconciledTransactions}</li>
        <li>Pending: ${summary.pendingTransactions} (amount £${summary.pendingAmount.toFixed(2)})</li>
        <li>Auto-match rate: ${(summary.autoMatchRate * 100).toFixed(1)}%</li>
        <li>Ledger pending entries: ${summary.ledgerPendingEntries}</li>
        <li>Open exceptions: ${summary.openExceptions} (critical: ${summary.criticalExceptions})</li>
      </ul>
      <h3>Variance (recent 7 days)</h3>
      <table border="1" cellpadding="6" cellspacing="0">
        <thead>
          <tr>
            <th>Date</th>
            <th>Bank total</th>
            <th>Ledger total</th>
            <th>Variance</th>
            <th>Variance %</th>
            <th>Unreconciled</th>
          </tr>
        </thead>
        <tbody>${varianceRows}</tbody>
      </table>
      <h3>Exception hotspots</h3>
      <ul>${hotspotRows}</ul>
    </div>
  `;
}
