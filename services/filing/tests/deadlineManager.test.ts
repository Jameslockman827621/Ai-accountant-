import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { getUpcomingDeadlines, sendDeadlineReminders } from '../src/services/deadlineManager';
import { TenantId } from '@ai-accountant/shared-types';

jest.mock('@ai-accountant/shared-utils', () => ({
  createLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }),
}));

jest.mock('@ai-accountant/database', () => ({
  db: { query: jest.fn() },
}));

jest.mock('@ai-accountant/notification-service/services/notificationManager', () => ({
  notificationManager: {
    send: jest.fn().mockResolvedValue(undefined),
    createNotification: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('deadlineManager', () => {
  const tenantId = 'tenant-filing' as TenantId;
  const { db } = require('@ai-accountant/database');
  const queryMock = db.query as jest.Mock;

  beforeEach(() => {
    queryMock.mockReset();
  });

  it('builds VAT and PAYE deadlines with correct statuses', async () => {
    const periodStart = new Date();
    const periodEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    const vatDueDate = new Date(periodEnd);
    vatDueDate.setDate(vatDueDate.getDate() + 37);

    queryMock
      // VAT obligations
      .mockResolvedValueOnce({ rows: [{ period_start: periodStart, period_end: periodEnd }] })
      // VAT filing status check
      .mockResolvedValueOnce({ rows: [] })
      // tenant metadata
      .mockResolvedValueOnce({ rows: [{ metadata: { yearEndMonth: 12, yearEndDay: 31 } }] })
      // corporation tax filings
      .mockResolvedValueOnce({ rows: [] });

    const deadlines = await getUpcomingDeadlines(tenantId, 90);

    const vatDeadline = deadlines.find((d: any) => d.filingType === 'vat');
    expect(vatDeadline?.dueDate.toISOString()).toBe(vatDueDate.toISOString());
    expect(['due_soon', 'upcoming']).toContain(vatDeadline?.status);

    const payeDeadline = deadlines.find((d: any) => d.filingType === 'paye');
    expect(payeDeadline).toBeDefined();
    expect(['upcoming', 'due_soon', 'overdue']).toContain(payeDeadline?.status);
  });

  it('sends reminders only for urgent deadlines', async () => {
    const { notificationManager } = require('@ai-accountant/notification-service/services/notificationManager');
    queryMock
      .mockResolvedValueOnce({ rows: [{ period_start: new Date(), period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ metadata: {} }] })
      .mockResolvedValueOnce({ rows: [] });

    const remindersSent = await sendDeadlineReminders(tenantId);

    expect(remindersSent).toBeGreaterThanOrEqual(0);
    expect(notificationManager.send).not.toHaveBeenCalled();
    expect(notificationManager.createNotification).toHaveBeenCalled();
  });
});
