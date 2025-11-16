import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('filing-service');

export interface FilingDeadline {
  filingType: 'vat' | 'paye' | 'corporation_tax' | 'income_tax';
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  daysUntilDue: number;
  status: 'upcoming' | 'due_soon' | 'overdue' | 'filed';
  filingId?: string;
}

/**
 * Proactive deadline management with reminders
 */
export async function getUpcomingDeadlines(
  tenantId: TenantId,
  daysAhead: number = 30
): Promise<FilingDeadline[]> {
  logger.info('Getting upcoming deadlines', { tenantId, daysAhead });

  const deadlines: FilingDeadline[] = [];
  const now = new Date();
  const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  // Get VAT obligations
  const vatObligations = await getVATObligations(tenantId);
  for (const obligation of vatObligations) {
    const dueDate = new Date(obligation.dueDate);
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    if (dueDate <= futureDate) {
      // Check if already filed
      const filingResult = await db.query<{
        id: string;
        status: string;
      }>(
        `SELECT id, status
         FROM filings
         WHERE tenant_id = $1
           AND filing_type = 'vat'
           AND period_start = $2
           AND period_end = $3
           AND status IN ('submitted', 'accepted')`,
        [tenantId, obligation.periodStart, obligation.periodEnd]
      );

      const status = filingResult.rows.length > 0
        ? 'filed'
        : daysUntilDue < 0
        ? 'overdue'
        : daysUntilDue <= 7
        ? 'due_soon'
        : 'upcoming';

      deadlines.push({
        filingType: 'vat',
        periodStart: obligation.periodStart,
        periodEnd: obligation.periodEnd,
        dueDate,
        daysUntilDue,
        status,
        filingId: filingResult.rows[0]?.id,
      });
    }
  }

  // Get PAYE deadlines (typically 19th of following month)
  const payeDeadlines = await getPAYEDeadlines(tenantId, futureDate);
  deadlines.push(...payeDeadlines);

  // Get Corporation Tax deadlines (9 months after year end)
  const ctDeadlines = await getCorporationTaxDeadlines(tenantId, futureDate);
  deadlines.push(...ctDeadlines);

  // Sort by due date
  deadlines.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  return deadlines;
}

/**
 * Send deadline reminders
 */
export async function sendDeadlineReminders(tenantId: TenantId): Promise<number> {
  const deadlines = await getUpcomingDeadlines(tenantId, 30);
  const remindersSent: string[] = [];

  for (const deadline of deadlines) {
    // Send reminder if due within 7 days or overdue
    if (deadline.status === 'due_soon' || deadline.status === 'overdue') {
      if (deadline.status === 'overdue') {
        await sendOverdueReminder(tenantId, deadline);
      } else if (deadline.daysUntilDue <= 7) {
        await sendDueSoonReminder(tenantId, deadline);
      }
      remindersSent.push(deadline.filingType);
    }
  }

  logger.info('Deadline reminders sent', { tenantId, count: remindersSent.length });

  return remindersSent.length;
}

async function getVATObligations(tenantId: TenantId): Promise<Array<{
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
}>> {
  // This would typically call HMRC API to get obligations
  // For now, return sample structure
  const result = await db.query<{
    period_start: Date;
    period_end: Date;
  }>(
    `SELECT DISTINCT period_start, period_end
     FROM filings
     WHERE tenant_id = $1
       AND filing_type = 'vat'
     ORDER BY period_end DESC
     LIMIT 12`,
    [tenantId]
  );

  return result.rows.map(row => {
    const periodEnd = row.period_end;
    const dueDate = new Date(periodEnd);
    dueDate.setDate(dueDate.getDate() + 37); // 1 month + 7 days

    return {
      periodStart: row.period_start,
      periodEnd: periodEnd,
      dueDate,
    };
  });
}

async function getPAYEDeadlines(
  tenantId: TenantId,
  futureDate: Date
): Promise<FilingDeadline[]> {
  const deadlines: FilingDeadline[] = [];
  const now = new Date();

  // PAYE is typically due on 19th of following month
  for (let i = 0; i < 3; i++) {
    const month = new Date(now.getFullYear(), now.getMonth() + i, 19);
    if (month <= futureDate) {
      const periodStart = new Date(month.getFullYear(), month.getMonth() - 1, 1);
      const periodEnd = new Date(month.getFullYear(), month.getMonth(), 0);

      const daysUntilDue = Math.ceil((month.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

      deadlines.push({
        filingType: 'paye',
        periodStart,
        periodEnd,
        dueDate: month,
        daysUntilDue,
        status: daysUntilDue < 0 ? 'overdue' : daysUntilDue <= 7 ? 'due_soon' : 'upcoming',
      });
    }
  }

  return deadlines;
}

async function getCorporationTaxDeadlines(
  tenantId: TenantId,
  futureDate: Date
): Promise<FilingDeadline[]> {
  // Corporation Tax is due 9 months after year end
  // This would typically come from company records
  return []; // Placeholder
}

async function sendDueSoonReminder(tenantId: TenantId, deadline: FilingDeadline): Promise<void> {
  // This would integrate with notification service
  logger.info('Sending due soon reminder', { tenantId, deadline });
  // Would call notification service here
}

async function sendOverdueReminder(tenantId: TenantId, deadline: FilingDeadline): Promise<void> {
  // This would integrate with notification service
  logger.warn('Sending overdue reminder', { tenantId, deadline });
  // Would call notification service here
}
