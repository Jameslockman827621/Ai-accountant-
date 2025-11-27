import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('retraining-scheduler');

export type RetrainingCadence = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface RetrainingJob {
  id: string;
  tenantId: TenantId;
  modelName: string;
  cadence: RetrainingCadence;
  nextRunAt: Date;
  lastRunAt?: Date;
  status: 'scheduled' | 'running' | 'paused';
  notes?: string;
}

export async function scheduleRetrainingJob(
  tenantId: TenantId,
  modelName: string,
  cadence: RetrainingCadence,
  notes?: string
): Promise<string> {
  const jobId = randomUUID();
  const nextRunAt = getNextRunDate(cadence);

  await db.query(
    `INSERT INTO retraining_jobs (id, tenant_id, model_name, cadence, next_run_at, status, notes, created_at)
     VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, NOW())`,
    [jobId, tenantId, modelName, cadence, nextRunAt, notes || null]
  );

  logger.info('Scheduled retraining job', { tenantId, modelName, cadence, nextRunAt });
  return jobId;
}

export async function getDueRetrainingJobs(): Promise<RetrainingJob[]> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    model_name: string;
    cadence: RetrainingCadence;
    next_run_at: Date;
    last_run_at: Date | null;
    status: 'scheduled' | 'running' | 'paused';
    notes: string | null;
  }>(
    `SELECT * FROM retraining_jobs
     WHERE status = 'scheduled'
       AND next_run_at <= NOW()
     ORDER BY next_run_at ASC`
  );

  return result.rows.map(row => ({
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    modelName: row.model_name,
    cadence: row.cadence,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at || undefined,
    status: row.status,
    notes: row.notes || undefined,
  }));
}

export async function markRetrainingComplete(jobId: string): Promise<void> {
  await db.query(
    `UPDATE retraining_jobs
     SET last_run_at = NOW(),
         next_run_at = CASE cadence
           WHEN 'daily' THEN NOW() + INTERVAL '1 day'
           WHEN 'weekly' THEN NOW() + INTERVAL '7 days'
           WHEN 'biweekly' THEN NOW() + INTERVAL '14 days'
           ELSE NOW() + INTERVAL '30 days'
         END,
         status = 'scheduled'
     WHERE id = $1`,
    [jobId]
  );

  logger.info('Retraining job completed', { jobId });
}

function getNextRunDate(cadence: RetrainingCadence): Date {
  const now = new Date();
  switch (cadence) {
    case 'daily':
      now.setDate(now.getDate() + 1);
      break;
    case 'weekly':
      now.setDate(now.getDate() + 7);
      break;
    case 'biweekly':
      now.setDate(now.getDate() + 14);
      break;
    default:
      now.setMonth(now.getMonth() + 1);
  }
  return now;
}
