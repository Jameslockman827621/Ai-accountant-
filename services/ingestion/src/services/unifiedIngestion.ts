import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

const logger = createLogger('unified-ingestion');

export type IngestionSourceType = 'bank_feed' | 'payroll' | 'commerce' | 'email' | 'webhook' | 'csv' | 'manual' | 'api';

export interface IngestionPayload {
  sourceType: IngestionSourceType;
  connectorId?: string;
  connectorProvider?: string;
  connectorVersion?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface IngestionResult {
  ingestionLogId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  classificationId?: string;
  reconciliationId?: string;
  exceptionId?: string;
}

export class UnifiedIngestionService {
  /**
   * Log an ingestion event
   */
  async logIngestion(
    tenantId: TenantId,
    userId: UserId,
    payload: IngestionPayload
  ): Promise<string> {
    const ingestionLogId = randomUUID();
    const payloadString = JSON.stringify(payload.payload);
    const payloadHash = createHash('sha256').update(payloadString).digest('hex');
    const payloadSize = Buffer.byteLength(payloadString, 'utf8');
    const payloadPreview = this.createPayloadPreview(payload.payload);

    // Store full payload in S3 (in production)
    const fullPayloadStorageKey = `ingestion/${tenantId}/${ingestionLogId}.json`;

    await db.query(
      `INSERT INTO ingestion_log (
        id, tenant_id, source_type, connector_id, connector_provider,
        connector_version, payload_hash, payload_size_bytes, payload_preview,
        full_payload_storage_key, processing_status, created_by, metadata,
        ingested_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13::jsonb, NOW(), NOW(), NOW())`,
      [
        ingestionLogId,
        tenantId,
        payload.sourceType,
        payload.connectorId || null,
        payload.connectorProvider || null,
        payload.connectorVersion || null,
        payloadHash,
        payloadSize,
        JSON.stringify(payloadPreview),
        fullPayloadStorageKey,
        'pending',
        userId,
        JSON.stringify(payload.metadata || {}),
      ]
    );

    logger.info('Ingestion logged', {
      ingestionLogId,
      tenantId,
      sourceType: payload.sourceType,
      payloadHash,
    });

    // Check for duplicates
    const duplicate = await this.checkDuplicate(tenantId, payloadHash);
    if (duplicate) {
      logger.warn('Duplicate ingestion detected', {
        ingestionLogId,
        duplicateId: duplicate,
        payloadHash,
      });
      await db.query(
        `UPDATE ingestion_log
         SET processing_status = 'failed',
             error_message = 'Duplicate ingestion detected',
             failed_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [ingestionLogId]
      );
      throw new Error('Duplicate ingestion detected');
    }

    return ingestionLogId;
  }

  /**
   * Update ingestion status
   */
  async updateIngestionStatus(
    ingestionLogId: string,
    status: 'processing' | 'completed' | 'failed',
    updates?: {
      classificationId?: string;
      classificationConfidence?: number;
      reconciliationId?: string;
      reconciliationStatus?: string;
      exceptionId?: string;
      errorMessage?: string;
      processingLatency?: number;
    }
  ): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramCount = 1;

    updates.push(`processing_status = $${paramCount++}`);
    params.push(status);

    if (status === 'processing') {
      updates.push(`processing_latency = $${paramCount++}`);
      params.push(updates?.processingLatency || null);
    }

    if (status === 'completed') {
      updates.push(`processed_at = NOW()`);
      updates.push(`completed_at = NOW()`);
      if (updates?.classificationId) {
        updates.push(`classification_id = $${paramCount++}`);
        params.push(updates.classificationId);
      }
      if (updates?.classificationConfidence !== undefined) {
        updates.push(`classification_confidence = $${paramCount++}`);
        params.push(updates.classificationConfidence);
      }
      if (updates?.reconciliationId) {
        updates.push(`reconciliation_id = $${paramCount++}`);
        params.push(updates.reconciliationId);
      }
      if (updates?.reconciliationStatus) {
        updates.push(`reconciliation_status = $${paramCount++}`);
        params.push(updates.reconciliationStatus);
      }
    }

    if (status === 'failed') {
      updates.push(`failed_at = NOW()`);
      if (updates?.errorMessage) {
        updates.push(`error_message = $${paramCount++}`);
        params.push(updates.errorMessage);
      }
      if (updates?.exceptionId) {
        updates.push(`exception_queue_id = $${paramCount++}`);
        params.push(updates.exceptionId);
      }
    }

    if (updates?.processingLatency && status !== 'processing') {
      updates.push(`processing_latency = $${paramCount++}`);
      params.push(updates.processingLatency);
    }

    params.push(ingestionLogId);

    await db.query(
      `UPDATE ingestion_log
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount}`,
      params
    );

    logger.info('Ingestion status updated', { ingestionLogId, status });
  }

  /**
   * Get ingestion statistics
   */
  async getIngestionStats(
    tenantId: TenantId,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    total: number;
    bySourceType: Record<string, number>;
    byStatus: Record<string, number>;
    avgLatency: number;
    successRate: number;
  }> {
    let query = `
      SELECT source_type, processing_status, COUNT(*) as count, AVG(processing_latency_ms) as avg_latency
      FROM ingestion_log
      WHERE tenant_id = $1
    `;
    const params: unknown[] = [tenantId];

    if (startDate) {
      query += ` AND ingested_at >= $${params.length + 1}`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND ingested_at <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += ` GROUP BY source_type, processing_status`;

    const result = await db.query(query, params);

    const bySourceType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let total = 0;
    let totalLatency = 0;
    let latencyCount = 0;
    let completed = 0;

    for (const row of result.rows) {
      total += parseInt(row.count, 10);
      bySourceType[row.source_type] = (bySourceType[row.source_type] || 0) + parseInt(row.count, 10);
      byStatus[row.processing_status] = (byStatus[row.processing_status] || 0) + parseInt(row.count, 10);

      if (row.processing_status === 'completed') {
        completed += parseInt(row.count, 10);
      }

      if (row.avg_latency) {
        totalLatency += parseFloat(row.avg_latency);
        latencyCount++;
      }
    }

    return {
      total,
      bySourceType,
      byStatus,
      avgLatency: latencyCount > 0 ? totalLatency / latencyCount : 0,
      successRate: total > 0 ? (completed / total) * 100 : 0,
    };
  }

  private async checkDuplicate(tenantId: TenantId, payloadHash: string): Promise<string | null> {
    const result = await db.query<{ id: string }>(
      `SELECT id FROM ingestion_log
       WHERE tenant_id = $1 AND payload_hash = $2 AND processing_status != 'failed'
       ORDER BY ingested_at DESC
       LIMIT 1`,
      [tenantId, payloadHash]
    );

    return result.rows.length > 0 ? result.rows[0].id : null;
  }

  private createPayloadPreview(payload: Record<string, unknown>, maxSize: number = 1024): Record<string, unknown> {
    const preview: Record<string, unknown> = {};
    let currentSize = 0;

    for (const [key, value] of Object.entries(payload)) {
      const valueStr = JSON.stringify(value);
      const entrySize = Buffer.byteLength(`${key}:${valueStr}`, 'utf8');

      if (currentSize + entrySize > maxSize) {
        preview['_truncated'] = true;
        break;
      }

      preview[key] = value;
      currentSize += entrySize;
    }

    return preview;
  }
}

export const unifiedIngestionService = new UnifiedIngestionService();
