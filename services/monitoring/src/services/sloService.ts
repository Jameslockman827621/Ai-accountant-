import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { metricsCollector } from '../index';

const logger = createLogger('slo-service');

export interface SLODefinition {
  id: string;
  sloName: string;
  serviceName: string;
  metricName: string;
  targetValue: number;
  windowDays: number;
  warningThreshold: number | null;
  criticalThreshold: number | null;
  enabled: boolean;
  description: string | null;
}

export interface SLOMeasurement {
  id: string;
  sloId: string;
  measuredValue: number;
  errorBudgetRemaining: number | null;
  status: 'healthy' | 'warning' | 'breached';
  measuredAt: Date;
  sampleCount: number | null;
}

/**
 * SLO Service (Chunk 2)
 * Manages Service Level Objectives and measurements
 */
export class SLOService {
  /**
   * Record SLO measurement
   */
  async recordMeasurement(
    sloName: string,
    measuredValue: number,
    sampleCount?: number
  ): Promise<void> {
    // Get SLO definition
    const slo = await this.getSLOByName(sloName);
    if (!slo || !slo.enabled) {
      return;
    }

    // Calculate error budget
    const errorBudgetRemaining = this.calculateErrorBudget(measuredValue, slo.targetValue);

    // Determine status
    let status: 'healthy' | 'warning' | 'breached' = 'healthy';
    if (slo.criticalThreshold && measuredValue > slo.criticalThreshold) {
      status = 'breached';
    } else if (slo.warningThreshold && measuredValue > slo.warningThreshold) {
      status = 'warning';
    }

    // Store measurement
    await db.query(
      `INSERT INTO slo_measurements (
        id, slo_id, measured_value, error_budget_remaining, status,
        sample_count, measured_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, NOW()
      )`,
      [slo.id, measuredValue, errorBudgetRemaining, status, sampleCount || null]
    );

    // Update metrics
    metricsCollector.setGauge(`slo_${sloName}_value`, measuredValue);
    metricsCollector.setGauge(`slo_${sloName}_error_budget`, errorBudgetRemaining || 0);
    metricsCollector.setGauge(`slo_${sloName}_status`, status === 'healthy' ? 1 : status === 'warning' ? 2 : 3);

    logger.debug('SLO measurement recorded', { sloName, measuredValue, status });
  }

  /**
   * Get SLO by name
   */
  async getSLOByName(sloName: string): Promise<SLODefinition | null> {
    const result = await db.query<{
      id: string;
      slo_name: string;
      service_name: string;
      metric_name: string;
      target_value: number;
      window_days: number;
      warning_threshold: number | null;
      critical_threshold: number | null;
      enabled: boolean;
      description: string | null;
    }>(
      `SELECT * FROM slo_definitions WHERE slo_name = $1`,
      [sloName]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      sloName: row.slo_name,
      serviceName: row.service_name,
      metricName: row.metric_name,
      targetValue: Number(row.target_value),
      windowDays: row.window_days,
      warningThreshold: row.warning_threshold ? Number(row.warning_threshold) : null,
      criticalThreshold: row.critical_threshold ? Number(row.critical_threshold) : null,
      enabled: row.enabled,
      description: row.description,
    };
  }

  /**
   * Get all SLOs
   */
  async getAllSLOs(): Promise<SLODefinition[]> {
    const result = await db.query<{
      id: string;
      slo_name: string;
      service_name: string;
      metric_name: string;
      target_value: number;
      window_days: number;
      warning_threshold: number | null;
      critical_threshold: number | null;
      enabled: boolean;
      description: string | null;
    }>(
      `SELECT * FROM slo_definitions WHERE enabled = true ORDER BY service_name, slo_name`
    );

    return result.rows.map(row => ({
      id: row.id,
      sloName: row.slo_name,
      serviceName: row.service_name,
      metricName: row.metric_name,
      targetValue: Number(row.target_value),
      windowDays: row.window_days,
      warningThreshold: row.warning_threshold ? Number(row.warning_threshold) : null,
      criticalThreshold: row.critical_threshold ? Number(row.critical_threshold) : null,
      enabled: row.enabled,
      description: row.description,
    }));
  }

  /**
   * Get recent measurements for SLO
   */
  async getRecentMeasurements(
    sloId: string,
    limit: number = 100
  ): Promise<SLOMeasurement[]> {
    const result = await db.query<{
      id: string;
      slo_id: string;
      measured_value: number;
      error_budget_remaining: number | null;
      status: string;
      measured_at: Date;
      sample_count: number | null;
    }>(
      `SELECT * FROM slo_measurements
       WHERE slo_id = $1
       ORDER BY measured_at DESC
       LIMIT $2`,
      [sloId, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      sloId: row.slo_id,
      measuredValue: Number(row.measured_value),
      errorBudgetRemaining: row.error_budget_remaining ? Number(row.error_budget_remaining) : null,
      status: row.status as SLOMeasurement['status'],
      measuredAt: row.measured_at,
      sampleCount: row.sample_count,
    }));
  }

  /**
   * Get current SLO status
   */
  async getSLOStatus(sloName: string): Promise<{
    slo: SLODefinition;
    currentValue: number;
    errorBudget: number;
    status: 'healthy' | 'warning' | 'breached';
    trend: 'improving' | 'stable' | 'degrading';
  } | null> {
    const slo = await this.getSLOByName(sloName);
    if (!slo) {
      return null;
    }

    // Get latest measurement
    const measurements = await this.getRecentMeasurements(slo.id, 2);
    if (measurements.length === 0) {
      return null;
    }

    const latest = measurements[0];
    const previous = measurements.length > 1 ? measurements[1] : null;

    // Determine trend
    let trend: 'improving' | 'stable' | 'degrading' = 'stable';
    if (previous) {
      if (latest.measuredValue < previous.measuredValue) {
        trend = 'improving';
      } else if (latest.measuredValue > previous.measuredValue) {
        trend = 'degrading';
      }
    }

    return {
      slo,
      currentValue: latest.measuredValue,
      errorBudget: latest.errorBudgetRemaining || 0,
      status: latest.status,
      trend,
    };
  }

  /**
   * Calculate error budget
   */
  private calculateErrorBudget(measuredValue: number, targetValue: number): number {
    // For latency: error budget is how much slower than target
    // For success rate: error budget is how much lower than target
    if (measuredValue <= targetValue) {
      return 1.0; // 100% budget remaining
    }

    const variance = measuredValue - targetValue;
    const budget = Math.max(0, 1.0 - variance / targetValue);
    return budget;
  }
}

export const sloService = new SLOService();
