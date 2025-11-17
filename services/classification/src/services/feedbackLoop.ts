import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, DocumentId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { goldenDatasetService } from '@ai-accountant/ingestion/src/services/goldenDataset';
import { modelRegistryService } from '@ai-accountant/modelops/src/services/modelRegistry';

const logger = createLogger('feedback-loop');

export interface ReviewerFeedback {
  documentId: DocumentId;
  reviewerId: UserId;
  action: 'approve' | 'edit' | 'reject';
  fieldCorrections?: Record<string, { original: unknown; corrected: unknown }>;
  ledgerCorrections?: Record<string, unknown>;
  notes?: string;
  confidenceOverride?: number;
}

export class FeedbackLoopService {
  /**
   * Process reviewer feedback and update golden labels
   */
  async processFeedback(tenantId: TenantId, feedback: ReviewerFeedback): Promise<void> {
    // Create golden labels from corrections
    if (feedback.fieldCorrections) {
      for (const [fieldName, correction] of Object.entries(feedback.fieldCorrections)) {
        await goldenDatasetService.createLabel(
          tenantId,
          {
            documentId: feedback.documentId,
            labelType: 'field_validation',
            fieldName,
            originalValue: correction.original,
            correctedValue: correction.corrected,
            confidenceScore: feedback.confidenceOverride,
          },
          feedback.reviewerId
        );
      }
    }

    // Create ledger posting labels
    if (feedback.ledgerCorrections) {
      await goldenDatasetService.createLabel(
        tenantId,
        {
          documentId: feedback.documentId,
          labelType: 'ledger_posting',
          expectedLedgerPosting: feedback.ledgerCorrections,
        },
        feedback.reviewerId
      );
    }

    logger.info('Feedback processed and golden labels created', {
      documentId: feedback.documentId,
      reviewerId: feedback.reviewerId,
      action: feedback.action,
    });
  }

  /**
   * Trigger retraining job (would be called by scheduler)
   */
  async triggerRetraining(modelName: string, modelVersion: string): Promise<string> {
    const model = await modelRegistryService.getModel(modelName, modelVersion);
    if (!model) {
      throw new Error(`Model not found: ${modelName} v${modelVersion}`);
    }

    const modelId = await this.getModelId(modelName, modelVersion);
    if (!modelId) {
      throw new Error('Model ID not found');
    }

    // Get latest golden labels for training data
    const trainingData = await this.getTrainingData(modelName);

    // Compute training data hash
    const trainingDataHash = modelRegistryService.computeTrainingDataHash(trainingData);

    // Create training job
    const jobId = randomUUID();
    await db.query(
      `INSERT INTO model_training_jobs (
        id, model_id, training_data_version, training_data_hash,
        status, started_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'pending', NOW(), NOW(), NOW())`,
      [jobId, modelId, modelVersion, trainingDataHash]
    );

    logger.info('Retraining job triggered', {
      jobId,
      modelName,
      modelVersion,
      trainingDataHash,
    });

    // In production, would trigger actual training pipeline (Dagster, Airflow, etc.)
    // For now, just log that training would be triggered

    return jobId;
  }

  /**
   * Check for accuracy regression after training
   */
  async checkRegression(jobId: string): Promise<{
    hasRegression: boolean;
    regressionAmount: number;
    driftDetected: boolean;
  }> {
    const result = await db.query<{
      metrics_before: unknown;
      metrics_after: unknown;
      accuracy_regression: number | null;
      drift_detected: boolean;
    }>(
      `SELECT metrics_before, metrics_after, accuracy_regression, drift_detected
       FROM model_training_jobs
       WHERE id = $1`,
      [jobId]
    );

    if (result.rows.length === 0) {
      throw new Error('Training job not found');
    }

    const job = result.rows[0];
    const metricsBefore = (job.metrics_before as { accuracy?: number }) || {};
    const metricsAfter = (job.metrics_after as { accuracy?: number }) || {};

    const accuracyBefore = metricsBefore.accuracy || 0;
    const accuracyAfter = metricsAfter.accuracy || 0;
    const regressionAmount = accuracyBefore - accuracyAfter;

    // Regression threshold: >2% decrease
    const hasRegression = regressionAmount > 0.02;

    return {
      hasRegression,
      regressionAmount,
      driftDetected: job.drift_detected || false,
    };
  }

  /**
   * Get training data from golden labels
   */
  private async getTrainingData(modelName: string): Promise<
    Array<{ id: string; label: unknown }>
  > {
    // Get recent golden labels
    const result = await db.query<{
      id: string;
      document_id: string;
      field_name: string;
      original_value: unknown;
      corrected_value: unknown;
    }>(
      `SELECT id, document_id, field_name, original_value, corrected_value
       FROM golden_labels
       WHERE label_type = 'field_validation'
       ORDER BY created_at DESC
       LIMIT 10000`
    );

    return result.rows.map((row) => ({
      id: row.id,
      label: {
        documentId: row.document_id,
        fieldName: row.field_name,
        original: row.original_value,
        corrected: row.corrected_value,
      },
    }));
  }

  /**
   * Get model ID
   */
  private async getModelId(modelName: string, modelVersion: string): Promise<string | null> {
    const result = await db.query<{ id: string }>(
      `SELECT id FROM model_registry
       WHERE model_name = $1 AND model_version = $2`,
      [modelName, modelVersion]
    );

    return result.rows.length > 0 ? result.rows[0].id : null;
  }

  /**
   * Update training job status
   */
  async updateTrainingJob(
    jobId: string,
    status: 'running' | 'completed' | 'failed',
    metrics?: {
      before?: Record<string, number>;
      after?: Record<string, number>;
    },
    error?: string
  ): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramCount = 1;

    updates.push(`status = $${paramCount++}`);
    params.push(status);

    if (status === 'completed') {
      updates.push(`completed_at = NOW()`);
      if (metrics?.before) {
        updates.push(`metrics_before = $${paramCount++}::jsonb`);
        params.push(JSON.stringify(metrics.before));
      }
      if (metrics?.after) {
        updates.push(`metrics_after = $${paramCount++}::jsonb`);
        params.push(JSON.stringify(metrics.after));
      }

      // Calculate accuracy regression
      if (metrics?.before?.accuracy && metrics?.after?.accuracy) {
        const regression = metrics.before.accuracy - metrics.after.accuracy;
        updates.push(`accuracy_regression = $${paramCount++}`);
        params.push(regression);

        // Check for drift
        const driftDetected = Math.abs(regression) > 0.02;
        updates.push(`drift_detected = $${paramCount++}`);
        params.push(driftDetected);
      }

      // Calculate duration
      const durationResult = await db.query<{ started_at: Date }>(
        `SELECT started_at FROM model_training_jobs WHERE id = $1`,
        [jobId]
      );
      if (durationResult.rows.length > 0) {
        const duration = Math.floor(
          (Date.now() - durationResult.rows[0].started_at.getTime()) / 1000
        );
        updates.push(`duration_seconds = $${paramCount++}`);
        params.push(duration);
      }
    }

    if (status === 'failed' && error) {
      updates.push(`error_message = $${paramCount++}`);
      params.push(error);
    }

    updates.push(`updated_at = NOW()`);
    params.push(jobId);

    await db.query(
      `UPDATE model_training_jobs
       SET ${updates.join(', ')}
       WHERE id = $${paramCount}`,
      params
    );

    logger.info('Training job updated', { jobId, status });
  }
}

export const feedbackLoopService = new FeedbackLoopService();
