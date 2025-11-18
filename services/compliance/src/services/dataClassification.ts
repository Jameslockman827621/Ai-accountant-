import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('compliance-service');

export interface DataClassification {
  id: string;
  tenantId: TenantId;
  dataType: 'pii' | 'financial' | 'health' | 'public' | 'other';
  sensitivityLevel: 'public' | 'internal' | 'confidential' | 'restricted';
  jurisdiction?: string;
  dataResidencyRegion: 'us' | 'uk' | 'eu' | 'ca' | 'global';
  storageLocation?: string;
  encryptionAtRest: boolean;
  encryptionInTransit: boolean;
  retentionPolicyDays?: number;
  autoDeleteEnabled: boolean;
  accessControls?: Record<string, unknown>;
  allowedRegions?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export class DataClassificationService {
  async createClassification(
    tenantId: TenantId,
    dataType: DataClassification['dataType'],
    sensitivityLevel: DataClassification['sensitivityLevel'],
    dataResidencyRegion: DataClassification['dataResidencyRegion'],
    options: {
      jurisdiction?: string;
      storageLocation?: string;
      encryptionAtRest?: boolean;
      encryptionInTransit?: boolean;
      retentionPolicyDays?: number;
      autoDeleteEnabled?: boolean;
      accessControls?: Record<string, unknown>;
      allowedRegions?: string[];
    } = {}
  ): Promise<DataClassification> {
    const id = randomUUID();

    await db.query(
      `INSERT INTO data_classification (
        id, tenant_id, data_type, sensitivity_level, jurisdiction,
        data_residency_region, storage_location, encryption_at_rest,
        encryption_in_transit, retention_policy_days, auto_delete_enabled,
        access_controls, allowed_regions
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
      [
        id,
        tenantId,
        dataType,
        sensitivityLevel,
        options.jurisdiction || null,
        dataResidencyRegion,
        options.storageLocation || null,
        options.encryptionAtRest !== undefined ? options.encryptionAtRest : true,
        options.encryptionInTransit !== undefined ? options.encryptionInTransit : true,
        options.retentionPolicyDays || null,
        options.autoDeleteEnabled !== undefined ? options.autoDeleteEnabled : false,
        options.accessControls ? JSON.stringify(options.accessControls) : null,
        options.allowedRegions || null,
      ]
    );

    logger.info('Data classification created', { id, tenantId, dataType, sensitivityLevel });
    return this.getClassification(id);
  }

  async getClassification(id: string): Promise<DataClassification> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      data_type: string;
      sensitivity_level: string;
      jurisdiction: string | null;
      data_residency_region: string;
      storage_location: string | null;
      encryption_at_rest: boolean;
      encryption_in_transit: boolean;
      retention_policy_days: number | null;
      auto_delete_enabled: boolean;
      access_controls: unknown;
      allowed_regions: string[] | null;
      created_at: Date;
      updated_at: Date;
    }>('SELECT * FROM data_classification WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new Error(`Data classification not found: ${id}`);
    }

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Data classification not found: ${id}`);
    }

    const classification: DataClassification = {
      id: row.id,
      tenantId: row.tenant_id as TenantId,
      dataType: row.data_type as DataClassification['dataType'],
      sensitivityLevel: row.sensitivity_level as DataClassification['sensitivityLevel'],
      dataResidencyRegion: row.data_residency_region as DataClassification['dataResidencyRegion'],
      encryptionAtRest: row.encryption_at_rest,
      encryptionInTransit: row.encryption_in_transit,
      autoDeleteEnabled: row.auto_delete_enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    if (row.jurisdiction) {
      classification.jurisdiction = row.jurisdiction;
    }
    if (row.storage_location) {
      classification.storageLocation = row.storage_location;
    }
    if (row.retention_policy_days !== null) {
      classification.retentionPolicyDays = row.retention_policy_days;
    }
    if (row.access_controls) {
      classification.accessControls = row.access_controls as Record<string, unknown>;
    }
    if (row.allowed_regions) {
      classification.allowedRegions = row.allowed_regions;
    }

    return classification;
  }

  async updateClassification(
    id: string,
    updates: {
      sensitivityLevel?: DataClassification['sensitivityLevel'];
      dataResidencyRegion?: DataClassification['dataResidencyRegion'];
      storageLocation?: string;
      encryptionAtRest?: boolean;
      encryptionInTransit?: boolean;
      retentionPolicyDays?: number;
      autoDeleteEnabled?: boolean;
      accessControls?: Record<string, unknown>;
      allowedRegions?: string[];
    }
  ): Promise<DataClassification> {
    const updateFields: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (updates.sensitivityLevel) {
      updateFields.push(`sensitivity_level = $${paramIndex++}`);
      params.push(updates.sensitivityLevel);
    }
    if (updates.dataResidencyRegion) {
      updateFields.push(`data_residency_region = $${paramIndex++}`);
      params.push(updates.dataResidencyRegion);
    }
    if (updates.storageLocation !== undefined) {
      updateFields.push(`storage_location = $${paramIndex++}`);
      params.push(updates.storageLocation);
    }
    if (updates.encryptionAtRest !== undefined) {
      updateFields.push(`encryption_at_rest = $${paramIndex++}`);
      params.push(updates.encryptionAtRest);
    }
    if (updates.encryptionInTransit !== undefined) {
      updateFields.push(`encryption_in_transit = $${paramIndex++}`);
      params.push(updates.encryptionInTransit);
    }
    if (updates.retentionPolicyDays !== undefined) {
      updateFields.push(`retention_policy_days = $${paramIndex++}`);
      params.push(updates.retentionPolicyDays);
    }
    if (updates.autoDeleteEnabled !== undefined) {
      updateFields.push(`auto_delete_enabled = $${paramIndex++}`);
      params.push(updates.autoDeleteEnabled);
    }
    if (updates.accessControls !== undefined) {
      updateFields.push(`access_controls = $${paramIndex++}::jsonb`);
      params.push(JSON.stringify(updates.accessControls));
    }
    if (updates.allowedRegions !== undefined) {
      updateFields.push(`allowed_regions = $${paramIndex++}`);
      params.push(updates.allowedRegions);
    }

    params.push(id);
    await db.query(
      `UPDATE data_classification SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
      params
    );

    logger.info('Data classification updated', { id });
    return this.getClassification(id);
  }

  async getClassifications(tenantId: TenantId): Promise<DataClassification[]> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      data_type: string;
      sensitivity_level: string;
      jurisdiction: string | null;
      data_residency_region: string;
      storage_location: string | null;
      encryption_at_rest: boolean;
      encryption_in_transit: boolean;
      retention_policy_days: number | null;
      auto_delete_enabled: boolean;
      access_controls: unknown;
      allowed_regions: string[] | null;
      created_at: Date;
      updated_at: Date;
    }>('SELECT * FROM data_classification WHERE tenant_id = $1 ORDER BY created_at DESC', [
      tenantId,
    ]);

    return result.rows.map((row) => {
      const classification: DataClassification = {
        id: row.id,
        tenantId: row.tenant_id as TenantId,
        dataType: row.data_type as DataClassification['dataType'],
        sensitivityLevel: row.sensitivity_level as DataClassification['sensitivityLevel'],
        dataResidencyRegion: row.data_residency_region as DataClassification['dataResidencyRegion'],
        encryptionAtRest: row.encryption_at_rest,
        encryptionInTransit: row.encryption_in_transit,
        autoDeleteEnabled: row.auto_delete_enabled,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      if (row.jurisdiction) {
        classification.jurisdiction = row.jurisdiction;
      }
      if (row.storage_location) {
        classification.storageLocation = row.storage_location;
      }
      if (row.retention_policy_days !== null) {
        classification.retentionPolicyDays = row.retention_policy_days;
      }
      if (row.access_controls) {
        classification.accessControls = row.access_controls as Record<string, unknown>;
      }
      if (row.allowed_regions) {
        classification.allowedRegions = row.allowed_regions;
      }

      return classification;
    });
  }
}

export const dataClassificationService = new DataClassificationService();
