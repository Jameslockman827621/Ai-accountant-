import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('monitoring-dr');

export interface DrSimulationLog {
  id: string;
  backupId: string;
  simulationId: string;
  rtoSeconds: number;
  rpoMinutes: number;
  status: 'passed' | 'failed';
  integrityVerified: boolean;
  notes?: string;
  createdAt: Date;
}

export class DisasterRecoveryService {
  async recordSimulation(entry: Omit<DrSimulationLog, 'id' | 'createdAt'>): Promise<DrSimulationLog> {
    const result = await db.query<DrSimulationLog>(
      `INSERT INTO dr_simulations (
        backup_id, simulation_id, rto_seconds, rpo_minutes, status,
        integrity_verified, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *, created_at`,
      [
        entry.backupId,
        entry.simulationId,
        entry.rtoSeconds,
        entry.rpoMinutes,
        entry.status,
        entry.integrityVerified,
        entry.notes || null,
      ]
    );

    const row = result.rows[0];
    logger.info('DR simulation recorded', { simulationId: row.simulationId, status: row.status });
    return { ...row, createdAt: row.createdAt } as DrSimulationLog;
  }

  async listSimulations(limit = 50): Promise<DrSimulationLog[]> {
    const result = await db.query<DrSimulationLog>(
      `SELECT * FROM dr_simulations
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => ({ ...row, createdAt: row.createdAt || (row as any).created_at } as DrSimulationLog));
  }

  async getRpoRtoSnapshot(): Promise<{ avgRtoSeconds: number; avgRpoMinutes: number; passRate: number }> {
    const result = await db.query<{ avg_rto: number | null; avg_rpo: number | null; pass_rate: number | null }>(
      `SELECT AVG(rto_seconds) as avg_rto,
              AVG(rpo_minutes) as avg_rpo,
              AVG(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as pass_rate
       FROM dr_simulations`
    );

    const row = result.rows[0];
    return {
      avgRtoSeconds: row.avg_rto || 0,
      avgRpoMinutes: row.avg_rpo || 0,
      passRate: row.pass_rate || 0,
    };
  }
}

export const disasterRecoveryService = new DisasterRecoveryService();
