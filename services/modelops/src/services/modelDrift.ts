import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { randomUUID } from 'crypto';

const logger = createLogger('modelops-service');

export interface ModelDriftDetection {
  id: string;
  modelId: string;
  driftType: 'data_drift' | 'concept_drift' | 'prediction_drift';
  detectedAt: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  baselineDistribution?: Record<string, unknown>;
  currentDistribution?: Record<string, unknown>;
  driftScore?: number;
  statisticalTest?: string;
  pValue?: number;
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNotes?: string;
  alertSent: boolean;
  alertSentAt?: Date;
  metadata?: Record<string, unknown>;
}

export class ModelDriftService {
  async detectDrift(
    modelId: string,
    driftType: ModelDriftDetection['driftType'],
    severity: ModelDriftDetection['severity'],
    options: {
      baselineDistribution?: Record<string, unknown>;
      currentDistribution?: Record<string, unknown>;
      driftScore?: number;
      statisticalTest?: string;
      pValue?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<ModelDriftDetection> {
    const id = randomUUID();

    await db.query(
      `INSERT INTO model_drift_detections (
        id, model_id, drift_type, detected_at, severity,
        baseline_distribution, current_distribution, drift_score,
        statistical_test, p_value, status, metadata
      ) VALUES ($1, $2, $3, NOW(), $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11::jsonb)`,
      [
        id,
        modelId,
        driftType,
        severity,
        options.baselineDistribution ? JSON.stringify(options.baselineDistribution) : null,
        options.currentDistribution ? JSON.stringify(options.currentDistribution) : null,
        options.driftScore || null,
        options.statisticalTest || null,
        options.pValue || null,
        'open',
        options.metadata ? JSON.stringify(options.metadata) : null,
      ]
    );

    logger.warn('Model drift detected', { id, modelId, driftType, severity });
    return this.getDriftDetection(id);
  }

  async getDriftDetection(id: string): Promise<ModelDriftDetection> {
    const result = await db.query<{
      id: string;
      model_id: string;
      drift_type: string;
      detected_at: Date;
      severity: string;
      baseline_distribution: unknown;
      current_distribution: unknown;
      drift_score: number | null;
      statistical_test: string | null;
      p_value: number | null;
      status: string;
      resolved_at: Date | null;
      resolved_by: string | null;
      resolution_notes: string | null;
      alert_sent: boolean;
      alert_sent_at: Date | null;
      metadata: unknown;
    }>('SELECT * FROM model_drift_detections WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new Error(`Drift detection not found: ${id}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      modelId: row.model_id,
      driftType: row.drift_type as ModelDriftDetection['driftType'],
      detectedAt: row.detected_at,
      severity: row.severity as ModelDriftDetection['severity'],
      baselineDistribution: row.baseline_distribution as Record<string, unknown> | undefined,
      currentDistribution: row.current_distribution as Record<string, unknown> | undefined,
      driftScore: row.drift_score || undefined,
      statisticalTest: row.statistical_test || undefined,
      pValue: row.p_value || undefined,
      status: row.status as ModelDriftDetection['status'],
      resolvedAt: row.resolved_at || undefined,
      resolvedBy: row.resolved_by || undefined,
      resolutionNotes: row.resolution_notes || undefined,
      alertSent: row.alert_sent,
      alertSentAt: row.alert_sent_at || undefined,
      metadata: row.metadata as Record<string, unknown> | undefined,
    };
  }

  async updateDriftStatus(
    id: string,
    status: ModelDriftDetection['status'],
    options: {
      resolvedBy?: string;
      resolutionNotes?: string;
    } = {}
  ): Promise<ModelDriftDetection> {
    const updates: string[] = ['status = $1'];
    const params: unknown[] = [status];
    let paramIndex = 2;

    if (status === 'resolved' || status === 'false_positive') {
      updates.push(`resolved_at = NOW()`);
      if (options.resolvedBy) {
        updates.push(`resolved_by = $${paramIndex++}`);
        params.push(options.resolvedBy);
      }
      if (options.resolutionNotes) {
        updates.push(`resolution_notes = $${paramIndex++}`);
        params.push(options.resolutionNotes);
      }
    }

    params.push(id);
    await db.query(`UPDATE model_drift_detections SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);

    logger.info('Drift detection status updated', { id, status });
    return this.getDriftDetection(id);
  }

  async markAlertSent(id: string): Promise<void> {
    await db.query('UPDATE model_drift_detections SET alert_sent = true, alert_sent_at = NOW() WHERE id = $1', [id]);
    logger.info('Drift alert marked as sent', { id });
  }

  async getDriftDetections(filters: {
    modelId?: string;
    driftType?: ModelDriftDetection['driftType'];
    severity?: ModelDriftDetection['severity'];
    status?: ModelDriftDetection['status'];
    limit?: number;
    offset?: number;
  } = {}): Promise<{ detections: ModelDriftDetection[]; total: number }> {
    let query = 'SELECT * FROM model_drift_detections WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.modelId) {
      query += ` AND model_id = $${paramIndex++}`;
      params.push(filters.modelId);
    }
    if (filters.driftType) {
      query += ` AND drift_type = $${paramIndex++}`;
      params.push(filters.driftType);
    }
    if (filters.severity) {
      query += ` AND severity = $${paramIndex++}`;
      params.push(filters.severity);
    }
    if (filters.status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await db.query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    query += ' ORDER BY detected_at DESC';
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
      model_id: string;
      drift_type: string;
      detected_at: Date;
      severity: string;
      baseline_distribution: unknown;
      current_distribution: unknown;
      drift_score: number | null;
      statistical_test: string | null;
      p_value: number | null;
      status: string;
      resolved_at: Date | null;
      resolved_by: string | null;
      resolution_notes: string | null;
      alert_sent: boolean;
      alert_sent_at: Date | null;
      metadata: unknown;
    }>(query, params);

    return {
      detections: result.rows.map((row) => ({
        id: row.id,
        modelId: row.model_id,
        driftType: row.drift_type as ModelDriftDetection['driftType'],
        detectedAt: row.detected_at,
        severity: row.severity as ModelDriftDetection['severity'],
        baselineDistribution: row.baseline_distribution as Record<string, unknown> | undefined,
        currentDistribution: row.current_distribution as Record<string, unknown> | undefined,
        driftScore: row.drift_score || undefined,
        statisticalTest: row.statistical_test || undefined,
        pValue: row.p_value || undefined,
        status: row.status as ModelDriftDetection['status'],
        resolvedAt: row.resolved_at || undefined,
        resolvedBy: row.resolved_by || undefined,
        resolutionNotes: row.resolution_notes || undefined,
        alertSent: row.alert_sent,
        alertSentAt: row.alert_sent_at || undefined,
        metadata: row.metadata as Record<string, unknown> | undefined,
      })),
      total,
    };
  }
}

export const modelDriftService = new ModelDriftService();
