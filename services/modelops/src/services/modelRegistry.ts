import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

const logger = createLogger('model-registry');

export type ModelType =
  | 'ocr'
  | 'classification'
  | 'extraction'
  | 'layout'
  | 'semantic'
  | 'forecasting';
export type RolloutStage = 'development' | 'staging' | 'production' | 'deprecated';

export interface ModelMetadata {
  modelName: string;
  modelVersion: string;
  modelType: ModelType;
  trainingDataHash: string;
  modelStoragePath?: string;
  metrics: Record<string, number>;
  hyperparameters: Record<string, unknown>;
  rolloutStage?: RolloutStage;
  performanceMetrics?: Record<string, number>;
  createdBy?: string;
}

export interface ModelPerformance {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  fieldLevelMetrics?: Record<string, {
    accuracy: number;
    precision: number;
    recall: number;
  }>;
}

export class ModelRegistryService {
  /**
   * Register a new model version
   */
  async registerModel(metadata: ModelMetadata): Promise<string> {
    const modelId = randomUUID();

    await db.query(
      `INSERT INTO model_registry (
        id, model_name, model_version, model_type, training_data_hash,
        model_storage_path, metrics, hyperparameters, rollout_stage,
        performance_metrics, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10::jsonb, $11, NOW(), NOW())`,
      [
        modelId,
        metadata.modelName,
        metadata.modelVersion,
        metadata.modelType,
        metadata.trainingDataHash,
        metadata.modelStoragePath || null,
        JSON.stringify(metadata.metrics),
        JSON.stringify(metadata.hyperparameters),
        metadata.rolloutStage || 'development',
        JSON.stringify(metadata.performanceMetrics || {}),
        metadata.createdBy || null,
      ]
    );

    logger.info('Model registered', {
      modelId,
      modelName: metadata.modelName,
      modelVersion: metadata.modelVersion,
      modelType: metadata.modelType,
    });

    return modelId;
  }

  /**
   * Get model by name and version
   */
  async getModel(modelName: string, modelVersion?: string): Promise<ModelMetadata | null> {
    let query = `
      SELECT id, model_name, model_version, model_type, training_data_hash,
             model_storage_path, metrics, hyperparameters, rollout_stage,
             performance_metrics, created_by, created_at
      FROM model_registry
      WHERE model_name = $1
    `;
    const params: unknown[] = [modelName];

    if (modelVersion) {
      query += ` AND model_version = $2`;
      params.push(modelVersion);
    } else {
      query += ` AND rollout_stage = 'production' ORDER BY created_at DESC LIMIT 1`;
    }

    const result = await db.query<{
      id: string;
      model_name: string;
      model_version: string;
      model_type: string;
      training_data_hash: string;
      model_storage_path: string | null;
      metrics: unknown;
      hyperparameters: unknown;
      rollout_stage: string;
      performance_metrics: unknown;
      created_by: string | null;
      created_at: Date;
    }>(query, params);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      modelName: row.model_name,
      modelVersion: row.model_version,
      modelType: row.model_type as ModelType,
      trainingDataHash: row.training_data_hash,
      modelStoragePath: row.model_storage_path || undefined,
      metrics: (row.metrics as Record<string, number>) || {},
      hyperparameters: (row.hyperparameters as Record<string, unknown>) || {},
      rolloutStage: row.rollout_stage as RolloutStage,
      performanceMetrics: (row.performance_metrics as Record<string, number>) || {},
      createdBy: row.created_by || undefined,
    };
  }

  /**
   * Update model rollout stage
   */
  async updateRolloutStage(
    modelName: string,
    modelVersion: string,
    stage: RolloutStage
  ): Promise<void> {
    await db.query(
      `UPDATE model_registry
       SET rollout_stage = $1, updated_at = NOW()
       WHERE model_name = $2 AND model_version = $3`,
      [stage, modelName, modelVersion]
    );

    logger.info('Model rollout stage updated', { modelName, modelVersion, stage });
  }

  /**
   * Update model performance metrics
   */
  async updatePerformanceMetrics(
    modelName: string,
    modelVersion: string,
    metrics: ModelPerformance
  ): Promise<void> {
    await db.query(
      `UPDATE model_registry
       SET performance_metrics = $1::jsonb, updated_at = NOW()
       WHERE model_name = $2 AND model_version = $3`,
      [
        JSON.stringify({
          accuracy: metrics.accuracy,
          precision: metrics.precision,
          recall: metrics.recall,
          f1Score: metrics.f1Score,
          fieldLevelMetrics: metrics.fieldLevelMetrics || {},
        }),
        modelName,
        modelVersion,
      ]
    );

    logger.info('Model performance metrics updated', { modelName, modelVersion });
  }

  /**
   * List models by type and stage
   */
  async listModels(
    modelType?: ModelType,
    rolloutStage?: RolloutStage
  ): Promise<ModelMetadata[]> {
    let query = `
      SELECT id, model_name, model_version, model_type, training_data_hash,
             model_storage_path, metrics, hyperparameters, rollout_stage,
             performance_metrics, created_by, created_at
      FROM model_registry
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (modelType) {
      query += ` AND model_type = $${params.length + 1}`;
      params.push(modelType);
    }

    if (rolloutStage) {
      query += ` AND rollout_stage = $${params.length + 1}`;
      params.push(rolloutStage);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await db.query<{
      id: string;
      model_name: string;
      model_version: string;
      model_type: string;
      training_data_hash: string;
      model_storage_path: string | null;
      metrics: unknown;
      hyperparameters: unknown;
      rollout_stage: string;
      performance_metrics: unknown;
      created_by: string | null;
      created_at: Date;
    }>(query, params);

    return result.rows.map((row) => ({
      modelName: row.model_name,
      modelVersion: row.model_version,
      modelType: row.model_type as ModelType,
      trainingDataHash: row.training_data_hash,
      modelStoragePath: row.model_storage_path || undefined,
      metrics: (row.metrics as Record<string, number>) || {},
      hyperparameters: (row.hyperparameters as Record<string, unknown>) || {},
      rolloutStage: row.rollout_stage as RolloutStage,
      performanceMetrics: (row.performance_metrics as Record<string, number>) || {},
      createdBy: row.created_by || undefined,
    }));
  }

  /**
   * Compute training data hash
   */
  computeTrainingDataHash(trainingData: Array<{ id: string; label: unknown }>): string {
    const dataString = JSON.stringify(trainingData.sort((a, b) => a.id.localeCompare(b.id)));
    return createHash('sha256').update(dataString).digest('hex');
  }
}

export const modelRegistryService = new ModelRegistryService();
