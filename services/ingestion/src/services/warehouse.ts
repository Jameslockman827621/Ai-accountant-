import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('warehouse');

export interface WarehouseSchema {
  schemaName: string;
  schemaVersion: string;
  schemaType: 'avro' | 'json' | 'parquet';
  schemaDefinition: Record<string, unknown>;
  backwardCompatible: boolean;
}

export class WarehouseService {
  /**
   * Register a warehouse schema
   */
  async registerSchema(schema: WarehouseSchema): Promise<string> {
    const schemaId = randomUUID();

    await db.query(
      `INSERT INTO warehouse_schemas (
        id, schema_name, schema_version, schema_type, schema_definition,
        backward_compatible, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())
      ON CONFLICT (schema_name, schema_version) DO UPDATE SET
        schema_definition = EXCLUDED.schema_definition,
        backward_compatible = EXCLUDED.backward_compatible,
        updated_at = NOW()`,
      [
        schemaId,
        schema.schemaName,
        schema.schemaVersion,
        schema.schemaType,
        JSON.stringify(schema.schemaDefinition),
        schema.backwardCompatible,
      ]
    );

    logger.info('Warehouse schema registered', {
      schemaId,
      schemaName: schema.schemaName,
      schemaVersion: schema.schemaVersion,
    });

    return schemaId;
  }

  /**
   * Create snapshot for tenant data
   */
  async createSnapshot(
    tenantId: TenantId,
    schemaName: string,
    snapshotDate: Date,
    storageLocation: string,
    recordCount: number
  ): Promise<string> {
    // Get schema
    const schemaResult = await db.query<{ id: string }>(
      `SELECT id FROM warehouse_schemas
       WHERE schema_name = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [schemaName]
    );

    if (schemaResult.rows.length === 0) {
      throw new Error(`Schema not found: ${schemaName}`);
    }

    const schemaId = schemaResult.rows[0].id;
    const snapshotId = randomUUID();

    await db.query(
      `INSERT INTO warehouse_snapshots (
        id, tenant_id, schema_id, snapshot_date, record_count,
        storage_location, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (tenant_id, schema_id, snapshot_date) DO UPDATE SET
        record_count = EXCLUDED.record_count,
        storage_location = EXCLUDED.storage_location`,
      [
        snapshotId,
        tenantId,
        schemaId,
        snapshotDate,
        recordCount,
        storageLocation,
      ]
    );

    logger.info('Warehouse snapshot created', {
      snapshotId,
      tenantId,
      schemaName,
      snapshotDate,
      recordCount,
    });

    return snapshotId;
  }

  /**
   * Get snapshots for tenant
   */
  async getSnapshots(
    tenantId: TenantId,
    schemaName?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<Array<{
    id: string;
    schemaName: string;
    snapshotDate: Date;
    recordCount: number;
    storageLocation: string;
    createdAt: Date;
  }>> {
    let query = `
      SELECT ws.id, ws.schema_name, ws.snapshot_date, ws.record_count,
             ws.storage_location, ws.created_at
      FROM warehouse_snapshots ws
      JOIN warehouse_schemas wsc ON wsc.id = ws.schema_id
      WHERE ws.tenant_id = $1
    `;
    const params: unknown[] = [tenantId];
    let paramCount = 2;

    if (schemaName) {
      query += ` AND wsc.schema_name = $${paramCount++}`;
      params.push(schemaName);
    }

    if (startDate) {
      query += ` AND ws.snapshot_date >= $${paramCount++}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND ws.snapshot_date <= $${paramCount++}`;
      params.push(endDate);
    }

    query += ` ORDER BY ws.snapshot_date DESC`;

    const result = await db.query<{
      id: string;
      schema_name: string;
      snapshot_date: Date;
      record_count: string;
      storage_location: string;
      created_at: Date;
    }>(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      schemaName: row.schema_name,
      snapshotDate: row.snapshot_date,
      recordCount: parseInt(row.record_count, 10),
      storageLocation: row.storage_location,
      createdAt: row.created_at,
    }));
  }

  /**
   * Define standard schemas
   */
  async defineStandardSchemas(): Promise<void> {
    // Document Extractions Schema
    await this.registerSchema({
      schemaName: 'document_extractions',
      schemaVersion: '1.0.0',
      schemaType: 'json',
      schemaDefinition: {
        type: 'object',
        properties: {
          document_id: { type: 'string' },
          tenant_id: { type: 'string' },
          extracted_fields: { type: 'object' },
          confidence_scores: { type: 'object' },
          extracted_at: { type: 'string', format: 'date-time' },
        },
        required: ['document_id', 'tenant_id', 'extracted_fields'],
      },
      backwardCompatible: true,
    });

    // Ledger Events Schema
    await this.registerSchema({
      schemaName: 'ledger_events',
      schemaVersion: '1.0.0',
      schemaType: 'json',
      schemaDefinition: {
        type: 'object',
        properties: {
          ledger_entry_id: { type: 'string' },
          tenant_id: { type: 'string' },
          entry_type: { type: 'string', enum: ['debit', 'credit'] },
          account_code: { type: 'string' },
          amount: { type: 'number' },
          currency: { type: 'string' },
          transaction_date: { type: 'string', format: 'date' },
          posted_at: { type: 'string', format: 'date-time' },
        },
        required: ['ledger_entry_id', 'tenant_id', 'entry_type', 'account_code', 'amount'],
      },
      backwardCompatible: true,
    });

    // Filing Snapshots Schema
    await this.registerSchema({
      schemaName: 'filing_snapshots',
      schemaVersion: '1.0.0',
      schemaType: 'json',
      schemaDefinition: {
        type: 'object',
        properties: {
          filing_id: { type: 'string' },
          tenant_id: { type: 'string' },
          filing_type: { type: 'string' },
          period_start: { type: 'string', format: 'date' },
          period_end: { type: 'string', format: 'date' },
          filing_data: { type: 'object' },
          status: { type: 'string' },
          submitted_at: { type: 'string', format: 'date-time' },
        },
        required: ['filing_id', 'tenant_id', 'filing_type', 'period_start', 'period_end'],
      },
      backwardCompatible: true,
    });

    logger.info('Standard warehouse schemas defined');
  }
}

export const warehouseService = new WarehouseService();
