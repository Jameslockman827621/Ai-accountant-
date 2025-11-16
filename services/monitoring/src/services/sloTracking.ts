import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { randomUUID } from 'crypto';

const logger = createLogger('monitoring-service');

export interface SLOTracking {
  id: string;
  serviceName: string;
  sloName: string;
  sloType: 'availability' | 'latency' | 'error_rate' | 'freshness';
  targetPercentage: number;
  measurementWindowHours: number;
  currentPercentage?: number;
  errorBudgetTotal?: number;
  errorBudgetConsumed?: number;
  errorBudgetRemaining?: number;
  errorBudgetBurnRate?: number;
  status: 'on_track' | 'at_risk' | 'breached';
  lastBreachAt?: Date;
  periodStart: Date;
  periodEnd: Date;
  measuredAt: Date;
  metadata?: Record<string, unknown>;
}

export class SLOTrackingService {
  async recordSLO(
    serviceName: string,
    sloName: string,
    sloType: SLOTracking['sloType'],
    targetPercentage: number,
    measurementWindowHours: number,
    options: {
      currentPercentage?: number;
      errorBudgetTotal?: number;
      errorBudgetConsumed?: number;
      errorBudgetRemaining?: number;
      errorBudgetBurnRate?: number;
      periodStart?: Date;
      periodEnd?: Date;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<SLOTracking> {
    const id = randomUUID();
    const periodStart = options.periodStart || new Date();
    const periodEnd = options.periodEnd || new Date(Date.now() + measurementWindowHours * 60 * 60 * 1000);

    // Calculate status
    let status: SLOTracking['status'] = 'on_track';
    if (options.currentPercentage !== undefined) {
      if (options.currentPercentage < targetPercentage) {
        status = 'breached';
      } else if (options.errorBudgetBurnRate && options.errorBudgetBurnRate > 1.0) {
        status = 'at_risk';
      }
    }

    await db.query(
      `INSERT INTO slo_tracking (
        id, service_name, slo_name, slo_type, target_percentage,
        measurement_window_hours, current_percentage, error_budget_total,
        error_budget_consumed, error_budget_remaining, error_budget_burn_rate,
        status, last_breach_at, period_start, period_end, measured_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), $16::jsonb)
      ON CONFLICT (service_name, slo_name, period_start) 
      DO UPDATE SET
        current_percentage = EXCLUDED.current_percentage,
        error_budget_total = EXCLUDED.error_budget_total,
        error_budget_consumed = EXCLUDED.error_budget_consumed,
        error_budget_remaining = EXCLUDED.error_budget_remaining,
        error_budget_burn_rate = EXCLUDED.error_budget_burn_rate,
        status = EXCLUDED.status,
        last_breach_at = CASE WHEN EXCLUDED.status = 'breached' THEN NOW() ELSE slo_tracking.last_breach_at END,
        measured_at = NOW()`,
      [
        id,
        serviceName,
        sloName,
        sloType,
        targetPercentage,
        measurementWindowHours,
        options.currentPercentage || null,
        options.errorBudgetTotal || null,
        options.errorBudgetConsumed || null,
        options.errorBudgetRemaining || null,
        options.errorBudgetBurnRate || null,
        status,
        status === 'breached' ? new Date() : null,
        periodStart,
        periodEnd,
        options.metadata ? JSON.stringify(options.metadata) : null,
      ]
    );

    logger.info('SLO recorded', { id, serviceName, sloName, status });
    return this.getSLO(id);
  }

  async getSLO(id: string): Promise<SLOTracking> {
    const result = await db.query<{
      id: string;
      service_name: string;
      slo_name: string;
      slo_type: string;
      target_percentage: number;
      measurement_window_hours: number;
      current_percentage: number | null;
      error_budget_total: number | null;
      error_budget_consumed: number | null;
      error_budget_remaining: number | null;
      error_budget_burn_rate: number | null;
      status: string;
      last_breach_at: Date | null;
      period_start: Date;
      period_end: Date;
      measured_at: Date;
      metadata: unknown;
    }>('SELECT * FROM slo_tracking WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new Error(`SLO tracking not found: ${id}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      serviceName: row.service_name,
      sloName: row.slo_name,
      sloType: row.slo_type as SLOTracking['sloType'],
      targetPercentage: row.target_percentage,
      measurementWindowHours: row.measurement_window_hours,
      currentPercentage: row.current_percentage || undefined,
      errorBudgetTotal: row.error_budget_total || undefined,
      errorBudgetConsumed: row.error_budget_consumed || undefined,
      errorBudgetRemaining: row.error_budget_remaining || undefined,
      errorBudgetBurnRate: row.error_budget_burn_rate || undefined,
      status: row.status as SLOTracking['status'],
      lastBreachAt: row.last_breach_at || undefined,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      measuredAt: row.measured_at,
      metadata: row.metadata as Record<string, unknown> | undefined,
    };
  }

  async getSLOs(filters: {
    serviceName?: string;
    sloType?: SLOTracking['sloType'];
    status?: SLOTracking['status'];
    limit?: number;
    offset?: number;
  } = {}): Promise<{ slos: SLOTracking[]; total: number }> {
    let query = 'SELECT * FROM slo_tracking WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.serviceName) {
      query += ` AND service_name = $${paramIndex++}`;
      params.push(filters.serviceName);
    }
    if (filters.sloType) {
      query += ` AND slo_type = $${paramIndex++}`;
      params.push(filters.sloType);
    }
    if (filters.status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await db.query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    query += ' ORDER BY measured_at DESC';
    if (filters.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }
    if (filters.offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(filters.offset);
    }

    const result = await db.query<{
      id: string;
      service_name: string;
      slo_name: string;
      slo_type: string;
      target_percentage: number;
      measurement_window_hours: number;
      current_percentage: number | null;
      error_budget_total: number | null;
      error_budget_consumed: number | null;
      error_budget_remaining: number | null;
      error_budget_burn_rate: number | null;
      status: string;
      last_breach_at: Date | null;
      period_start: Date;
      period_end: Date;
      measured_at: Date;
      metadata: unknown;
    }>(query, params);

    return {
      slos: result.rows.map((row) => ({
        id: row.id,
        serviceName: row.service_name,
        sloName: row.slo_name,
        sloType: row.slo_type as SLOTracking['sloType'],
        targetPercentage: row.target_percentage,
        measurementWindowHours: row.measurement_window_hours,
        currentPercentage: row.current_percentage || undefined,
        errorBudgetTotal: row.error_budget_total || undefined,
        errorBudgetConsumed: row.error_budget_consumed || undefined,
        errorBudgetRemaining: row.error_budget_remaining || undefined,
        errorBudgetBurnRate: row.error_budget_burn_rate || undefined,
        status: row.status as SLOTracking['status'],
        lastBreachAt: row.last_breach_at || undefined,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        measuredAt: row.measured_at,
        metadata: row.metadata as Record<string, unknown> | undefined,
      })),
      total,
    };
  }
}

export const sloTrackingService = new SLOTrackingService();
