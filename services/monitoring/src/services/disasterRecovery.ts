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
  private memoryLogs: DrSimulationLog[] = [];

  async recordSimulation(entry: Omit<DrSimulationLog, 'id' | 'createdAt'>): Promise<DrSimulationLog> {
    try {
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

      const row = result.rows[0] as unknown as {
        id: string;
        backup_id: string;
        simulation_id: string;
        rto_seconds: number;
        rpo_minutes: number;
        status: 'passed' | 'failed';
        integrity_verified: boolean;
        notes?: string | null;
        created_at: Date;
      };

      const normalized: DrSimulationLog = {
        id: row.id,
        backupId: row.backup_id,
        simulationId: row.simulation_id,
        rtoSeconds: row.rto_seconds,
        rpoMinutes: row.rpo_minutes,
        status: row.status,
        integrityVerified: row.integrity_verified,
        notes: row.notes || undefined,
        createdAt: row.created_at,
      };

      logger.info('DR simulation recorded', { simulationId: normalized.simulationId, status: normalized.status });
      return normalized;
    } catch (error) {
      logger.warn('Falling back to in-memory DR log store', error as Error);
      const normalized: DrSimulationLog = {
        ...entry,
        id: `mem-${Date.now()}`,
        createdAt: new Date(),
      };
      this.memoryLogs.unshift(normalized);
      return normalized;
    }
  }

  async listSimulations(limit = 50): Promise<DrSimulationLog[]> {
    try {
      const result = await db.query(
        `SELECT * FROM dr_simulations
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );

      return result.rows.map((row: any) => ({
        id: row.id,
        backupId: row.backup_id,
        simulationId: row.simulation_id,
        rtoSeconds: row.rto_seconds,
        rpoMinutes: row.rpo_minutes,
        status: row.status,
        integrityVerified: row.integrity_verified,
        notes: row.notes || undefined,
        createdAt: row.created_at,
      }));
    } catch (error) {
      logger.warn('Falling back to in-memory DR log retrieval', error as Error);
      return this.memoryLogs.slice(0, limit);
    }
  }

  async getRpoRtoSnapshot(): Promise<{ avgRtoSeconds: number; avgRpoMinutes: number; passRate: number }> {
    try {
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
    } catch (error) {
      logger.warn('Falling back to in-memory DR metrics', error as Error);
      if (this.memoryLogs.length === 0) {
        return { avgRtoSeconds: 0, avgRpoMinutes: 0, passRate: 0 };
      }

      const avgRtoSeconds =
        this.memoryLogs.reduce((sum, log) => sum + log.rtoSeconds, 0) / this.memoryLogs.length;
      const avgRpoMinutes =
        this.memoryLogs.reduce((sum, log) => sum + log.rpoMinutes, 0) / this.memoryLogs.length;
      const passRate = this.memoryLogs.filter((log) => log.status === 'passed').length / this.memoryLogs.length;

      return { avgRtoSeconds, avgRpoMinutes, passRate };
    }
  }
}

export const disasterRecoveryService = new DisasterRecoveryService();
