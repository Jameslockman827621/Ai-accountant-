import cron from 'node-cron';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';

const logger = createLogger('filing-scheduler');

async function sweepUpcomingDeadlines(): Promise<void> {
  const upcomingWindowDays = Number(process.env.FILING_REMINDER_WINDOW_DAYS || 7);
  const now = new Date();
  const reminderWindowEnd = new Date(now.getTime() + upcomingWindowDays * 24 * 60 * 60 * 1000);

  const filings = await db.query<{
    id: string;
    tenant_id: string;
    filing_type: string;
    period_end: Date | null;
  }>(
    `SELECT id, tenant_id, filing_type, period_end
     FROM filings
     WHERE status IN ('draft', 'pending_approval')`
  );

  for (const filing of filings.rows) {
    if (!filing.period_end) {
      continue;
    }

    const dueDate = new Date(filing.period_end);
    dueDate.setMonth(dueDate.getMonth() + 1);

    if (dueDate < now || dueDate > reminderWindowEnd) {
      continue;
    }

    await db.query(
      `INSERT INTO filing_deadline_events (filing_id, tenant_id, event_type, scheduled_for)
       VALUES ($1, $2, 'deadline_reminder', $3)
       ON CONFLICT (filing_id, event_type) DO NOTHING`,
      [filing.id, filing.tenant_id, dueDate]
    );

    logger.info('Scheduled filing reminder', {
      filingId: filing.id,
      tenantId: filing.tenant_id,
      filingType: filing.filing_type,
      dueDate,
    });
  }
}

export function startFilingScheduler(): void {
  const cronExpression = process.env.FILING_REMINDER_SCHEDULE || '0 * * * *';
  cron.schedule(cronExpression, () => {
    sweepUpcomingDeadlines().catch((error) => {
      logger.error('Filing reminder sweep failed', error instanceof Error ? error : new Error(String(error)));
    });
  });

  logger.info('Filing reminder scheduler started', { cronExpression });
  void sweepUpcomingDeadlines();
}
