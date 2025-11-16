import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { randomUUID } from 'crypto';

const logger = createLogger('quality-service');

export interface GoldenDataset {
  id: string;
  name: string;
  jurisdiction?: string;
  filingType?: string;
  documentType?: string;
  version: string;
  description?: string;
  samples: Array<{
    input: unknown;
    expectedOutput: unknown;
    tolerance?: unknown;
    annotations?: Record<string, unknown>;
  }>;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  createdBy?: string;
  isActive: boolean;
}

export class GoldenDatasetService {
  async createDataset(
    name: string,
    samples: GoldenDataset['samples'],
    options: {
      jurisdiction?: string;
      filingType?: string;
      documentType?: string;
      version?: string;
      description?: string;
      metadata?: Record<string, unknown>;
      createdBy?: string;
    } = {}
  ): Promise<GoldenDataset> {
    const version = options.version || '1.0.0';
    const id = randomUUID();

    await db.query(
      `INSERT INTO golden_datasets (
        id, name, jurisdiction, filing_type, document_type, version,
        description, samples, metadata, created_by, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)`,
      [
        id,
        name,
        options.jurisdiction || null,
        options.filingType || null,
        options.documentType || null,
        version,
        options.description || null,
        JSON.stringify(samples),
        options.metadata ? JSON.stringify(options.metadata) : null,
        options.createdBy || null,
        true,
      ]
    );

    logger.info('Golden dataset created', { id, name, version });
    return this.getDataset(id);
  }

  async getDataset(id: string): Promise<GoldenDataset> {
    const result = await db.query<{
      id: string;
      name: string;
      jurisdiction: string | null;
      filing_type: string | null;
      document_type: string | null;
      version: string;
      description: string | null;
      samples: unknown;
      metadata: unknown;
      created_at: Date;
      created_by: string | null;
      is_active: boolean;
    }>('SELECT * FROM golden_datasets WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new Error(`Golden dataset not found: ${id}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      jurisdiction: row.jurisdiction || undefined,
      filingType: row.filing_type || undefined,
      documentType: row.document_type || undefined,
      version: row.version,
      description: row.description || undefined,
      samples: row.samples as GoldenDataset['samples'],
      metadata: row.metadata as Record<string, unknown> | undefined,
      createdAt: row.created_at,
      createdBy: row.created_by || undefined,
      isActive: row.is_active,
    };
  }

  async listDatasets(filters: {
    jurisdiction?: string;
    filingType?: string;
    documentType?: string;
    isActive?: boolean;
  } = {}): Promise<GoldenDataset[]> {
    let query = 'SELECT * FROM golden_datasets WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.jurisdiction) {
      query += ` AND jurisdiction = $${paramIndex++}`;
      params.push(filters.jurisdiction);
    }
    if (filters.filingType) {
      query += ` AND filing_type = $${paramIndex++}`;
      params.push(filters.filingType);
    }
    if (filters.documentType) {
      query += ` AND document_type = $${paramIndex++}`;
      params.push(filters.documentType);
    }
    if (filters.isActive !== undefined) {
      query += ` AND is_active = $${paramIndex++}`;
      params.push(filters.isActive);
    }

    query += ' ORDER BY created_at DESC';

    const result = await db.query<{
      id: string;
      name: string;
      jurisdiction: string | null;
      filing_type: string | null;
      document_type: string | null;
      version: string;
      description: string | null;
      samples: unknown;
      metadata: unknown;
      created_at: Date;
      created_by: string | null;
      is_active: boolean;
    }>(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      jurisdiction: row.jurisdiction || undefined,
      filingType: row.filing_type || undefined,
      documentType: row.document_type || undefined,
      version: row.version,
      description: row.description || undefined,
      samples: row.samples as GoldenDataset['samples'],
      metadata: row.metadata as Record<string, unknown> | undefined,
      createdAt: row.created_at,
      createdBy: row.created_by || undefined,
      isActive: row.is_active,
    }));
  }

  async createVersion(
    datasetId: string,
    newVersion: string,
    samples: GoldenDataset['samples'],
    options: {
      description?: string;
      metadata?: Record<string, unknown>;
      createdBy?: string;
    } = {}
  ): Promise<GoldenDataset> {
    const existing = await this.getDataset(datasetId);
    const id = randomUUID();

    await db.query(
      `INSERT INTO golden_datasets (
        id, name, jurisdiction, filing_type, document_type, version,
        description, samples, metadata, created_by, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)`,
      [
        id,
        existing.name,
        existing.jurisdiction || null,
        existing.filingType || null,
        existing.documentType || null,
        newVersion,
        options.description || existing.description || null,
        JSON.stringify(samples),
        options.metadata ? JSON.stringify(options.metadata) : existing.metadata ? JSON.stringify(existing.metadata) : null,
        options.createdBy || null,
        true,
      ]
    );

    logger.info('Golden dataset version created', { id, name: existing.name, version: newVersion });
    return this.getDataset(id);
  }

  async deactivateDataset(id: string): Promise<void> {
    await db.query('UPDATE golden_datasets SET is_active = false WHERE id = $1', [id]);
    logger.info('Golden dataset deactivated', { id });
  }
}

export const goldenDatasetService = new GoldenDatasetService();
