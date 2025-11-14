import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { sendFilingReminder, sendDocumentReviewRequired, sendComplianceAlert } from './emailTemplates';

const logger = createLogger('notification-service');

/**
 * Send automated reminders for upcoming deadlines
 */
export async function sendAutomatedReminders(tenantId: TenantId): Promise<number> {
  logger.info('Sending automated reminders', { tenantId });

  // Get tenant details
  const tenant = await db.query<{
    name: string;
    email: string;
  }>(
    `SELECT t.name, u.email
     FROM tenants t
     JOIN users u ON u.tenant_id = t.id
     WHERE t.id = $1 AND u.role = 'accountant'
     LIMIT 1`,
    [tenantId]
  );

  const tenantRow = tenant.rows[0];
  if (!tenantRow) {
    return 0;
  }

  const tenantName = tenantRow.name;
  const email = tenantRow.email;

  let remindersSent = 0;

  // Get upcoming filing deadlines
  const upcomingFilings = await db.query<{
    filing_type: string;
    period_end: Date;
    due_date: Date;
  }>(
    `SELECT filing_type, period_end, due_date
     FROM filings
     WHERE tenant_id = $1
       AND status = 'draft'
       AND due_date BETWEEN NOW() AND NOW() + INTERVAL '14 days'`,
    [tenantId]
  );

  for (const filing of upcomingFilings.rows) {
    await sendFilingReminder(email, filing.filing_type, filing.due_date, tenantName);
    remindersSent++;
  }

  // Get documents requiring review
  const reviewDocs = await db.query<{
    id: string;
    file_name: string;
    confidence_score: number;
  }>(
    `SELECT id, file_name, confidence_score
     FROM documents
     WHERE tenant_id = $1
       AND status IN ('extracted', 'classified')
       AND confidence_score < 0.85
       AND created_at > NOW() - INTERVAL '7 days'`,
    [tenantId]
  );

  for (const doc of reviewDocs.rows) {
    await sendDocumentReviewRequired(email, doc.file_name, doc.confidence_score || 0, tenantName);
    remindersSent++;
  }

  // Get compliance issues
  const complianceIssues = await db.query<{
    issue: string;
    severity: string;
  }>(
    `SELECT issue, severity
     FROM compliance_issues
     WHERE tenant_id = $1
       AND status = 'open'
       AND severity IN ('critical', 'warning')
       AND created_at > NOW() - INTERVAL '7 days'`,
    [tenantId]
  );

  for (const issue of complianceIssues.rows) {
    await sendComplianceAlert(
      email,
      issue.issue,
      issue.severity as 'critical' | 'warning' | 'info',
      tenantName
    );
    remindersSent++;
  }

  logger.info('Automated reminders sent', { tenantId, remindersSent });
  return remindersSent;
}

/**
 * Schedule recurring reminders
 */
export async function scheduleRecurringReminders(tenantId: TenantId): Promise<void> {
  // This would integrate with a job scheduler (e.g., node-cron)
  // For now, just log
  logger.info('Scheduling recurring reminders', { tenantId });
  
  // In production, would set up cron job:
  // cron.schedule('0 9 * * *', () => sendAutomatedReminders(tenantId));
}
