import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

const logger = createLogger('golden-dataset');

export type SamplingStrategy = 'random' | 'stratified' | 'confidence_based' | 'vendor_based' | 'category_based';
export type LabelType = 'field_validation' | 'ledger_posting' | 'anomaly_tag' | 'category_tag';

export interface GoldenLabel {
  documentId?: string;
  ledgerEntryId?: string;
  labelType: LabelType;
  fieldName?: string;
  originalValue?: unknown;
  correctedValue?: unknown;
  confidenceScore?: number;
  isAnomaly?: boolean;
  anomalyReason?: string;
  expectedLedgerPosting?: Record<string, unknown>;
}

export interface DatasetVersion {
  datasetName: string;
  version: string;
  semanticVersion?: string;
  storageLocation?: string;
  storageFormat?: 'delta_lake' | 'parquet' | 'json';
  provenance?: Record<string, unknown>;
}

export class GoldenDatasetService {
  /**
   * Create or update golden label
   */
  async createLabel(
    tenantId: TenantId,
    label: GoldenLabel,
    reviewedBy: UserId
  ): Promise<string> {
    const labelId = randomUUID();

    await db.query(
      `INSERT INTO golden_labels (
        id, tenant_id, document_id, ledger_entry_id, label_type,
        field_name, original_value, corrected_value, confidence_score,
        is_anomaly, anomaly_reason, expected_ledger_posting,
        reviewed_by, reviewed_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12::jsonb, $13, NOW(), NOW(), NOW())`,
      [
        labelId,
        tenantId,
        label.documentId || null,
        label.ledgerEntryId || null,
        label.labelType,
        label.fieldName || null,
        label.originalValue ? JSON.stringify(label.originalValue) : null,
        label.correctedValue ? JSON.stringify(label.correctedValue) : null,
        label.confidenceScore || null,
        label.isAnomaly || false,
        label.anomalyReason || null,
        label.expectedLedgerPosting ? JSON.stringify(label.expectedLedgerPosting) : null,
        reviewedBy,
      ]
    );

    logger.info('Golden label created', { labelId, tenantId, labelType: label.labelType });

    return labelId;
  }

  /**
   * Sample documents for labeling
   */
  async sampleForLabeling(
    tenantId: TenantId,
    strategy: SamplingStrategy,
    count: number,
    options?: {
      vendorName?: string;
      category?: string;
      minConfidence?: number;
      maxConfidence?: number;
    }
  ): Promise<Array<{ documentId: string; priority: number }>> {
    let query = `
      SELECT d.id as document_id, d.confidence_score, d.extracted_data
      FROM documents d
      WHERE d.tenant_id = $1
        AND d.status = 'extracted'
        AND d.id NOT IN (
          SELECT DISTINCT document_id FROM golden_labels WHERE tenant_id = $1 AND document_id IS NOT NULL
        )
    `;
    const params: unknown[] = [tenantId];
    let paramCount = 2;

    // Apply strategy-specific filters
    switch (strategy) {
      case 'vendor_based':
        if (options?.vendorName) {
          query += ` AND d.extracted_data->>'vendor_name' = $${paramCount++}`;
          params.push(options.vendorName);
        }
        break;
      case 'category_based':
        if (options?.category) {
          query += ` AND d.extracted_data->>'category' = $${paramCount++}`;
          params.push(options.category);
        }
        break;
      case 'confidence_based':
        if (options?.minConfidence !== undefined) {
          query += ` AND d.confidence_score >= $${paramCount++}`;
          params.push(options.minConfidence);
        }
        if (options?.maxConfidence !== undefined) {
          query += ` AND d.confidence_score <= $${paramCount++}`;
          params.push(options.maxConfidence);
        }
        break;
    }

    // Order by strategy
    switch (strategy) {
      case 'confidence_based':
        query += ` ORDER BY ABS(d.confidence_score - 0.5) ASC`; // Prefer uncertain
        break;
      case 'random':
        query += ` ORDER BY RANDOM()`;
        break;
      default:
        query += ` ORDER BY d.created_at DESC`;
    }

    query += ` LIMIT $${paramCount++}`;
    params.push(count);

    const result = await db.query<{
      document_id: string;
      confidence_score: number | null;
    }>(query, params);

    const samples = result.rows.map((row, index) => {
      // Calculate priority based on strategy
      let priority = count - index; // Higher priority for earlier samples

      if (strategy === 'confidence_based' && row.confidence_score !== null) {
        // Lower confidence = higher priority
        priority = Math.round((1 - row.confidence_score) * 100);
      }

      return {
        documentId: row.document_id,
        priority,
      };
    });

    // Create sample records
    for (const sample of samples) {
      await db.query(
        `INSERT INTO golden_dataset_samples (
          id, tenant_id, document_id, sampling_strategy, priority, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT DO NOTHING`,
        [
          randomUUID(),
          tenantId,
          sample.documentId,
          strategy,
          sample.priority,
          'pending',
        ]
      );
    }

    logger.info('Samples created for labeling', {
      tenantId,
      strategy,
      count: samples.length,
    });

    return samples;
  }

  /**
   * Assign sample to reviewer
   */
  async assignSample(sampleId: string, assignedTo: UserId): Promise<void> {
    await db.query(
      `UPDATE golden_dataset_samples
       SET status = 'assigned', assigned_to = $1, assigned_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND status = 'pending'`,
      [assignedTo, sampleId]
    );

    logger.info('Sample assigned', { sampleId, assignedTo });
  }

  /**
   * Create dataset version
   */
  async createDatasetVersion(
    dataset: DatasetVersion,
    createdBy: UserId
  ): Promise<string> {
    // Count labels
    const labelCountResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM golden_labels`
    );
    const labelCount = parseInt(labelCountResult.rows[0]?.count || '0', 10);

    // Count samples
    const sampleCountResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM golden_dataset_samples WHERE status = 'labeled'`
    );
    const sampleCount = parseInt(sampleCountResult.rows[0]?.count || '0', 10);

    // Calculate coverage by category
    const coverageResult = await db.query<{ category: string; count: string }>(
      `SELECT 
        COALESCE(d.extracted_data->>'category', 'unknown') as category,
        COUNT(*) as count
       FROM golden_labels gl
       JOIN documents d ON d.id = gl.document_id
       WHERE gl.document_id IS NOT NULL
       GROUP BY category`
    );

    const coverageByCategory: Record<string, number> = {};
    for (const row of coverageResult.rows) {
      coverageByCategory[row.category] = parseInt(row.count, 10);
    }

    const versionId = randomUUID();

    await db.query(
      `INSERT INTO golden_dataset_versions (
        id, dataset_name, version, semantic_version, label_count, sample_count,
        coverage_by_category, storage_location, storage_format, provenance,
        created_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, $11, NOW())`,
      [
        versionId,
        dataset.datasetName,
        dataset.version,
        dataset.semanticVersion || null,
        labelCount,
        sampleCount,
        JSON.stringify(coverageByCategory),
        dataset.storageLocation || null,
        dataset.storageFormat || null,
        JSON.stringify(dataset.provenance || {}),
        createdBy,
      ]
    );

    logger.info('Dataset version created', {
      versionId,
      datasetName: dataset.datasetName,
      version: dataset.version,
      labelCount,
      sampleCount,
    });

    return versionId;
  }

  /**
   * Get dataset statistics
   */
  async getDatasetStats(datasetName: string, version?: string): Promise<{
    labelCount: number;
    sampleCount: number;
    coverageByCategory: Record<string, number>;
    anomalyCount: number;
  }> {
    let query = `
      SELECT label_count, sample_count, coverage_by_category
      FROM golden_dataset_versions
      WHERE dataset_name = $1
    `;
    const params: unknown[] = [datasetName];

    if (version) {
      query += ` AND version = $2`;
      params.push(version);
    } else {
      query += ` ORDER BY created_at DESC LIMIT 1`;
    }

    const result = await db.query<{
      label_count: string;
      sample_count: string;
      coverage_by_category: unknown;
    }>(query, params);

    if (result.rows.length === 0) {
      throw new Error(`Dataset not found: ${datasetName}`);
    }

    const row = result.rows[0];
    const coverageByCategory = (row.coverage_by_category as Record<string, number>) || {};

    // Get anomaly count
    const anomalyResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM golden_labels WHERE is_anomaly = true`
    );
    const anomalyCount = parseInt(anomalyResult.rows[0]?.count || '0', 10);

    return {
      labelCount: parseInt(row.label_count, 10),
      sampleCount: parseInt(row.sample_count, 10),
      coverageByCategory,
      anomalyCount,
    };
  }

  /**
   * Run sampling cron job (should be called periodically)
   */
  async runSamplingJob(tenantId: TenantId): Promise<void> {
    // Target: ≥30 samples per category monthly
    const targetSamplesPerCategory = 30;

    // Get categories with low coverage
    const coverageResult = await db.query<{ category: string; count: string }>(
      `SELECT 
        COALESCE(d.extracted_data->>'category', 'unknown') as category,
        COUNT(DISTINCT gl.id) as count
       FROM documents d
       LEFT JOIN golden_labels gl ON gl.document_id = d.id
       WHERE d.tenant_id = $1 AND d.status = 'extracted'
       GROUP BY category
       HAVING COUNT(DISTINCT gl.id) < $2`,
      [tenantId, targetSamplesPerCategory]
    );

    for (const row of coverageResult.rows) {
      const currentCount = parseInt(row.count, 10);
      const needed = targetSamplesPerCategory - currentCount;

      if (needed > 0) {
        await this.sampleForLabeling(tenantId, 'category_based', needed, {
          category: row.category,
        });
      }
    }

    logger.info('Sampling job completed', { tenantId });
  }
}

export const goldenDatasetService = new GoldenDatasetService();
