import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { sendEmail, generateFilingReminderEmail } from './services/email';
import { FilingType } from '@ai-accountant/shared-types';

const logger = createLogger('notification-service');

// Check for upcoming filing deadlines daily
export function startScheduler(): void {
  // Run every day at 9 AM
  const checkInterval = 24 * 60 * 60 * 1000; // 24 hours
  const initialDelay = getMillisecondsUntil9AM();

  setTimeout(() => {
    checkFilingDeadlines();
    setInterval(checkFilingDeadlines, checkInterval);
  }, initialDelay);

  logger.info('Notification scheduler started');
}

function getMillisecondsUntil9AM(): number {
  const now = new Date();
  const nineAM = new Date();
  nineAM.setHours(9, 0, 0, 0);

  if (nineAM <= now) {
    nineAM.setDate(nineAM.getDate() + 1);
  }

  return nineAM.getTime() - now.getTime();
}

async function checkFilingDeadlines(): Promise<void> {
  try {
    logger.info('Checking filing deadlines...');

    // Get all active tenants
    const tenantsResult = await db.query(
      `SELECT t.id, t.name, u.email
       FROM tenants t
       JOIN users u ON u.tenant_id = t.id
       WHERE u.role = 'client' AND u.is_active = true`
    );

    for (const tenant of tenantsResult.rows) {
      // Check VAT filing deadlines (typically quarterly)
      const today = new Date();
      const daysAhead = 7; // Remind 7 days before

      // Calculate next VAT filing deadline (simplified - in production, use actual HMRC obligations)
      const quarterEnd = getQuarterEnd(today);
      const deadline = new Date(quarterEnd);
      deadline.setDate(deadline.getDate() + 30); // VAT due 30 days after quarter end

      const daysUntilDeadline = Math.floor((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      if (daysUntilDeadline === daysAhead) {
        // Check if filing already exists
        const filingResult = await db.query(
          `SELECT id FROM filings
           WHERE tenant_id = $1
             AND filing_type = $2
             AND period_end = $3
             AND status IN ('submitted', 'accepted')`,
          [tenant.id, FilingType.VAT, quarterEnd]
        );

        if (filingResult.rows.length === 0) {
          // Send reminder
          const { subject, html } = generateFilingReminderEmail('VAT', deadline, tenant.name);
          try {
            await sendEmail(tenant.email, subject, html);
            logger.info('Filing reminder sent', { tenantId: tenant.id, email: tenant.email });
          } catch (error) {
            logger.error('Failed to send reminder', error instanceof Error ? error : new Error(String(error)));
          }
        }
      }
    }
  } catch (error) {
    logger.error('Failed to check filing deadlines', error instanceof Error ? error : new Error(String(error)));
  }
}

function getQuarterEnd(date: Date): Date {
  const month = date.getMonth();
  const quarter = Math.floor(month / 3);
  const quarterEndMonth = (quarter + 1) * 3 - 1;
  return new Date(date.getFullYear(), quarterEndMonth + 1, 0);
}
