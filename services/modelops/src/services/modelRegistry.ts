import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { randomUUID } from 'crypto';

const logger = createLogger('modelops-service');

export interface ModelRegistry {
  id: string;
  modelName: string;
  modelType: 'classification' | 'extraction' | 'prediction' | 'other';
  version: string;
  trainingDataHash?: string;
  trainingDataLineage?: Record<string, unknown>;
  trainingConfig?: Record<string, unknown>;
  trainingMetrics?: Record<string, unknown>;
  evaluationMetrics?: Record<string, unknown>;
  goldenDatasetScores?: Record<string, unknown>;
  fairnessMetrics?: Record<string, unknown>;
  status: 'draft' | 'training' | 'evaluating' | 'approved' | 'deployed' | 'deprecated';
  deployedAt?: Date;
  deployedBy?: string;
  rolloutPercentage: number;
  ownerTeam?: string;
  ownerEmail?: string;
  modelArtifactPath?: string;
  explainabilityArtifacts?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class ModelRegistryService {
  async registerModel(
    modelName: string,
    modelType: ModelRegistry['modelType'],
    version: string,
    options: {
      trainingDataHash?: string;
      trainingDataLineage?: Record<string, unknown>;
      trainingConfig?: Record<string, unknown>;
      trainingMetrics?: Record<string, unknown>;
      evaluationMetrics?: Record<string, unknown>;
      goldenDatasetScores?: Record<string, unknown>;
      fairnessMetrics?: Record<string, unknown>;
      ownerTeam?: string;
      ownerEmail?: string;
      modelArtifactPath?: string;
      explainabilityArtifacts?: Record<string, unknown>;
    } = {}
  ): Promise<ModelRegistry> {
    const id = randomUUID();

    await db.query(
      `INSERT INTO model_registry (
        id, model_name, model_type, version, training_data_hash,
        training_data_lineage, training_config, training_metrics,
        evaluation_metrics, golden_dataset_scores, fairness_metrics,
        status, owner_team, owner_email, model_artifact_path, explainability_artifacts
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16::jsonb)`,
      [
        id,
        modelName,
        modelType,
        version,
        options.trainingDataHash || null,
        options.trainingDataLineage ? JSON.stringify(options.trainingDataLineage) : null,
        options.trainingConfig ? JSON.stringify(options.trainingConfig) : null,
        options.trainingMetrics ? JSON.stringify(options.trainingMetrics) : null,
        options.evaluationMetrics ? JSON.stringify(options.evaluationMetrics) : null,
        options.goldenDatasetScores ? JSON.stringify(options.goldenDatasetScores) : null,
        options.fairnessMetrics ? JSON.stringify(options.fairnessMetrics) : null,
        'draft',
        options.ownerTeam || null,
        options.ownerEmail || null,
        options.modelArtifactPath || null,
        options.explainabilityArtifacts ? JSON.stringify(options.explainabilityArtifacts) : null,
      ]
    );

    logger.info('Model registered', { id, modelName, version });
    return this.getModel(id);
  }

  async getModel(id: string): Promise<ModelRegistry> {
    const result = await db.query<{
      id: string;
      model_name: string;
      model_type: string;
      version: string;
      training_data_hash: string | null;
      training_data_lineage: unknown;
      training_config: unknown;
      training_metrics: unknown;
      evaluation_metrics: unknown;
      golden_dataset_scores: unknown;
      fairness_metrics: unknown;
      status: string;
      deployed_at: Date | null;
      deployed_by: string | null;
      rollout_percentage: number;
      owner_team: string | null;
      owner_email: string | null;
      model_artifact_path: string | null;
      explainability_artifacts: unknown;
      created_at: Date;
      updated_at: Date;
    }>('SELECT * FROM model_registry WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new Error(`Model not found: ${id}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      modelName: row.model_name,
      modelType: row.model_type as ModelRegistry['modelType'],
      version: row.version,
      trainingDataHash: row.training_data_hash || undefined,
      trainingDataLineage: row.training_data_lineage as Record<string, unknown> | undefined,
      trainingConfig: row.training_config as Record<string, unknown> | undefined,
      trainingMetrics: row.training_metrics as Record<string, unknown> | undefined,
      evaluationMetrics: row.evaluation_metrics as Record<string, unknown> | undefined,
      goldenDatasetScores: row.golden_dataset_scores as Record<string, unknown> | undefined,
      fairnessMetrics: row.fairness_metrics as Record<string, unknown> | undefined,
      status: row.status as ModelRegistry['status'],
      deployedAt: row.deployed_at || undefined,
      deployedBy: row.deployed_by || undefined,
      rolloutPercentage: row.rollout_percentage,
      ownerTeam: row.owner_team || undefined,
      ownerEmail: row.owner_email || undefined,
      modelArtifactPath: row.model_artifact_path || undefined,
      explainabilityArtifacts: row.explainability_artifacts as Record<string, unknown> | undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async updateModelStatus(
    id: string,
    status: ModelRegistry['status'],
    options: {
      deployedBy?: string;
      rolloutPercentage?: number;
      evaluationMetrics?: Record<string, unknown>;
      goldenDatasetScores?: Record<string, unknown>;
      fairnessMetrics?: Record<string, unknown>;
    } = {}
  ): Promise<ModelRegistry> {
    const updates: string[] = ['status = $1', 'updated_at = NOW()'];
    const params: unknown[] = [status];
    let paramIndex = 2;

    if (status === 'deployed') {
      updates.push(`deployed_at = NOW()`);
      if (options.deployedBy) {
        updates.push(`deployed_by = $${paramIndex++}`);
        params.push(options.deployedBy);
      }
      if (options.rolloutPercentage !== undefined) {
        updates.push(`rollout_percentage = $${paramIndex++}`);
        params.push(options.rolloutPercentage);
      }
    }

    if (options.evaluationMetrics) {
      updates.push(`evaluation_metrics = $${paramIndex++}::jsonb`);
      params.push(JSON.stringify(options.evaluationMetrics));
    }
    if (options.goldenDatasetScores) {
      updates.push(`golden_dataset_scores = $${paramIndex++}::jsonb`);
      params.push(JSON.stringify(options.goldenDatasetScores));
    }
    if (options.fairnessMetrics) {
      updates.push(`fairness_metrics = $${paramIndex++}::jsonb`);
      params.push(JSON.stringify(options.fairnessMetrics));
    }

    params.push(id);
    await db.query(`UPDATE model_registry SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);

    logger.info('Model status updated', { id, status });
    return this.getModel(id);
  }

  async listModels(filters: {
    modelName?: string;
    modelType?: ModelRegistry['modelType'];
    status?: ModelRegistry['status'];
    limit?: number;
    offset?: number;
  } = {}): Promise<{ models: ModelRegistry[]; total: number }> {
    let query = 'SELECT * FROM model_registry WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.modelName) {
      query += ` AND model_name = $${paramIndex++}`;
      params.push(filters.modelName);
    }
    if (filters.modelType) {
      query += ` AND model_type = $${paramIndex++}`;
      params.push(filters.modelType);
    }
    if (filters.status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await db.query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    query += ' ORDER BY created_at DESC';
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
      model_name: string;
      model_type: string;
      version: string;
      training_data_hash: string | null;
      training_data_lineage: unknown;
      training_config: unknown;
      training_metrics: unknown;
      evaluation_metrics: unknown;
      golden_dataset_scores: unknown;
      fairness_metrics: unknown;
      status: string;
      deployed_at: Date | null;
      deployed_by: string | null;
      rollout_percentage: number;
      owner_team: string | null;
      owner_email: string | null;
      model_artifact_path: string | null;
      explainability_artifacts: unknown;
      created_at: Date;
      updated_at: Date;
    }>(query, params);

    return {
      models: result.rows.map((row) => ({
        id: row.id,
        modelName: row.model_name,
        modelType: row.model_type as ModelRegistry['modelType'],
        version: row.version,
        trainingDataHash: row.training_data_hash || undefined,
        trainingDataLineage: row.training_data_lineage as Record<string, unknown> | undefined,
        trainingConfig: row.training_config as Record<string, unknown> | undefined,
        trainingMetrics: row.training_metrics as Record<string, unknown> | undefined,
        evaluationMetrics: row.evaluation_metrics as Record<string, unknown> | undefined,
        goldenDatasetScores: row.golden_dataset_scores as Record<string, unknown> | undefined,
        fairnessMetrics: row.fairness_metrics as Record<string, unknown> | undefined,
        status: row.status as ModelRegistry['status'],
        deployedAt: row.deployed_at || undefined,
        deployedBy: row.deployed_by || undefined,
        rolloutPercentage: row.rollout_percentage,
        ownerTeam: row.owner_team || undefined,
        ownerEmail: row.owner_email || undefined,
        modelArtifactPath: row.model_artifact_path || undefined,
        explainabilityArtifacts: row.explainability_artifacts as Record<string, unknown> | undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      total,
    };
  }
}

export const modelRegistryService = new ModelRegistryService();
