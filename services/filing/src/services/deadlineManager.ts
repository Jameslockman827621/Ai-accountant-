import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { notificationManager } from '@ai-accountant/notification-service/services/notificationManager';

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
  const deadlines: FilingDeadline[] = [];
  const now = new Date();

  // Get company year end from tenant metadata or filings
  const tenantResult = await db.query<{
    metadata: unknown;
  }>(
    `SELECT metadata FROM tenants WHERE id = $1`,
    [tenantId]
  );

  const metadata = tenantResult.rows[0]?.metadata as Record<string, unknown> | null;
  const yearEndMonth = (metadata?.yearEndMonth as number) || 3; // Default to March
  const yearEndDay = (metadata?.yearEndDay as number) || 31;

  // Get most recent Corporation Tax filing to determine year end
  const filingResult = await db.query<{
    period_end: Date;
  }>(
    `SELECT period_end
     FROM filings
     WHERE tenant_id = $1
       AND filing_type = 'corporation_tax'
     ORDER BY period_end DESC
     LIMIT 1`,
    [tenantId]
  );

  let yearEndDate: Date;
  if (filingResult.rows.length > 0) {
    // Use the period end from last filing as year end
    const lastPeriodEnd = filingResult.rows[0].period_end;
    yearEndDate = new Date(lastPeriodEnd);
    yearEndDate.setFullYear(yearEndDate.getFullYear() + 1);
  } else {
    // Calculate from current date
    const currentYear = now.getFullYear();
    yearEndDate = new Date(currentYear, yearEndMonth - 1, yearEndDay);
    if (yearEndDate < now) {
      yearEndDate.setFullYear(currentYear + 1);
    }
  }

  // Corporation Tax is due 9 months after year end
  const dueDate = new Date(yearEndDate);
  dueDate.setMonth(dueDate.getMonth() + 9);

  if (dueDate <= futureDate) {
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    // Check if already filed
    const filingCheck = await db.query<{
      id: string;
      status: string;
    }>(
      `SELECT id, status
       FROM filings
       WHERE tenant_id = $1
         AND filing_type = 'corporation_tax'
         AND period_end = $2
         AND status IN ('submitted', 'accepted')`,
      [tenantId, yearEndDate]
    );

    const periodStart = new Date(yearEndDate);
    periodStart.setFullYear(periodStart.getFullYear() - 1);
    periodStart.setDate(1);

    const status = filingCheck.rows.length > 0
      ? 'filed'
      : daysUntilDue < 0
      ? 'overdue'
      : daysUntilDue <= 7
      ? 'due_soon'
      : 'upcoming';

    deadlines.push({
      filingType: 'corporation_tax',
      periodStart,
      periodEnd: yearEndDate,
      dueDate,
      daysUntilDue,
      status,
      filingId: filingCheck.rows[0]?.id,
    });
  }

  return deadlines;
}

async function sendDueSoonReminder(tenantId: TenantId, deadline: FilingDeadline): Promise<void> {
  logger.info('Sending due soon reminder', { tenantId, deadline });

  const filingTypeLabels: Record<FilingDeadline['filingType'], string> = {
    vat: 'VAT Return',
    paye: 'PAYE Return',
    corporation_tax: 'Corporation Tax Return',
    income_tax: 'Income Tax Return',
  };

  await notificationManager.createNotification(
    tenantId,
    null, // Tenant-wide notification
    'warning',
    `${filingTypeLabels[deadline.filingType]} Due Soon`,
    `Your ${filingTypeLabels[deadline.filingType]} for the period ${deadline.periodStart.toLocaleDateString()} to ${deadline.periodEnd.toLocaleDateString()} is due in ${deadline.daysUntilDue} days (${deadline.dueDate.toLocaleDateString()}).`,
    {
      label: 'View Filing',
      url: `/filings?filingType=${deadline.filingType}&periodStart=${deadline.periodStart.toISOString()}&periodEnd=${deadline.periodEnd.toISOString()}`,
    },
    {
      deadlineType: deadline.filingType,
      periodStart: deadline.periodStart.toISOString(),
      periodEnd: deadline.periodEnd.toISOString(),
      dueDate: deadline.dueDate.toISOString(),
      daysUntilDue: deadline.daysUntilDue,
    }
  );
}

async function sendOverdueReminder(tenantId: TenantId, deadline: FilingDeadline): Promise<void> {
  logger.warn('Sending overdue reminder', { tenantId, deadline });

  const filingTypeLabels: Record<FilingDeadline['filingType'], string> = {
    vat: 'VAT Return',
    paye: 'PAYE Return',
    corporation_tax: 'Corporation Tax Return',
    income_tax: 'Income Tax Return',
  };

  await notificationManager.createNotification(
    tenantId,
    null, // Tenant-wide notification
    'error',
    `${filingTypeLabels[deadline.filingType]} Overdue`,
    `Your ${filingTypeLabels[deadline.filingType]} for the period ${deadline.periodStart.toLocaleDateString()} to ${deadline.periodEnd.toLocaleDateString()} is overdue. It was due on ${deadline.dueDate.toLocaleDateString()}. Please file immediately to avoid penalties.`,
    {
      label: 'File Now',
      url: `/filings?filingType=${deadline.filingType}&periodStart=${deadline.periodStart.toISOString()}&periodEnd=${deadline.periodEnd.toISOString()}`,
    },
    {
      deadlineType: deadline.filingType,
      periodStart: deadline.periodStart.toISOString(),
      periodEnd: deadline.periodEnd.toISOString(),
      dueDate: deadline.dueDate.toISOString(),
      daysUntilDue: deadline.daysUntilDue,
      overdue: true,
    }
  );
}
