import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { randomUUID } from 'crypto';

const logger = createLogger('security-service');

export interface SecretRotationLog {
  id: string;
  secretName: string;
  secretType: 'api_key' | 'oauth_token' | 'database_password' | 'encryption_key' | 'other';
  rotatedAt: Date;
  rotatedBy?: string;
  rotationMethod: 'automatic' | 'manual';
  oldSecretHash?: string;
  newSecretHash?: string;
  rotationPolicy?: string;
  nextRotationDue?: Date;
  status: 'success' | 'failed' | 'partial';
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export class SecretRotationService {
  async logRotation(
    secretName: string,
    secretType: SecretRotationLog['secretType'],
    rotationMethod: SecretRotationLog['rotationMethod'],
    status: SecretRotationLog['status'],
    options: {
      rotatedBy?: string;
      oldSecretHash?: string;
      newSecretHash?: string;
      rotationPolicy?: string;
      nextRotationDue?: Date;
      errorMessage?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<SecretRotationLog> {
    const id = randomUUID();

    await db.query(
      `INSERT INTO secret_rotation_log (
        id, secret_name, secret_type, rotated_at, rotated_by,
        rotation_method, old_secret_hash, new_secret_hash,
        rotation_policy, next_rotation_due, status, error_message, metadata
      ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
      [
        id,
        secretName,
        secretType,
        options.rotatedBy || null,
        rotationMethod,
        options.oldSecretHash || null,
        options.newSecretHash || null,
        options.rotationPolicy || null,
        options.nextRotationDue || null,
        status,
        options.errorMessage || null,
        options.metadata ? JSON.stringify(options.metadata) : null,
      ]
    );

    logger.info('Secret rotation logged', { id, secretName, secretType, status });
    return this.getRotationLog(id);
  }

  async getRotationLog(id: string): Promise<SecretRotationLog> {
    const result = await db.query<{
      id: string;
      secret_name: string;
      secret_type: string;
      rotated_at: Date;
      rotated_by: string | null;
      rotation_method: string;
      old_secret_hash: string | null;
      new_secret_hash: string | null;
      rotation_policy: string | null;
      next_rotation_due: Date | null;
      status: string;
      error_message: string | null;
      metadata: unknown;
    }>('SELECT * FROM secret_rotation_log WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new Error(`Secret rotation log not found: ${id}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      secretName: row.secret_name,
      secretType: row.secret_type as SecretRotationLog['secretType'],
      rotatedAt: row.rotated_at,
      rotatedBy: row.rotated_by || undefined,
      rotationMethod: row.rotation_method as SecretRotationLog['rotationMethod'],
      oldSecretHash: row.old_secret_hash || undefined,
      newSecretHash: row.new_secret_hash || undefined,
      rotationPolicy: row.rotation_policy || undefined,
      nextRotationDue: row.next_rotation_due || undefined,
      status: row.status as SecretRotationLog['status'],
      errorMessage: row.error_message || undefined,
      metadata: row.metadata as Record<string, unknown> | undefined,
    };
  }

  async getRotationLogs(filters: {
    secretName?: string;
    secretType?: SecretRotationLog['secretType'];
    status?: SecretRotationLog['status'];
    limit?: number;
    offset?: number;
  } = {}): Promise<{ logs: SecretRotationLog[]; total: number }> {
    let query = 'SELECT * FROM secret_rotation_log WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.secretName) {
      query += ` AND secret_name = $${paramIndex++}`;
      params.push(filters.secretName);
    }
    if (filters.secretType) {
      query += ` AND secret_type = $${paramIndex++}`;
      params.push(filters.secretType);
    }
    if (filters.status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await db.query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    query += ' ORDER BY rotated_at DESC';
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
      secret_name: string;
      secret_type: string;
      rotated_at: Date;
      rotated_by: string | null;
      rotation_method: string;
      old_secret_hash: string | null;
      new_secret_hash: string | null;
      rotation_policy: string | null;
      next_rotation_due: Date | null;
      status: string;
      error_message: string | null;
      metadata: unknown;
    }>(query, params);

    return {
      logs: result.rows.map((row) => ({
        id: row.id,
        secretName: row.secret_name,
        secretType: row.secret_type as SecretRotationLog['secretType'],
        rotatedAt: row.rotated_at,
        rotatedBy: row.rotated_by || undefined,
        rotationMethod: row.rotation_method as SecretRotationLog['rotationMethod'],
        oldSecretHash: row.old_secret_hash || undefined,
        newSecretHash: row.new_secret_hash || undefined,
        rotationPolicy: row.rotation_policy || undefined,
        nextRotationDue: row.next_rotation_due || undefined,
        status: row.status as SecretRotationLog['status'],
        errorMessage: row.error_message || undefined,
        metadata: row.metadata as Record<string, unknown> | undefined,
      })),
      total,
    };
  }

  async getDueRotations(): Promise<SecretRotationLog[]> {
    const result = await db.query<{
      id: string;
      secret_name: string;
      secret_type: string;
      rotated_at: Date;
      rotated_by: string | null;
      rotation_method: string;
      old_secret_hash: string | null;
      new_secret_hash: string | null;
      rotation_policy: string | null;
      next_rotation_due: Date | null;
      status: string;
      error_message: string | null;
      metadata: unknown;
    }>(
      `SELECT DISTINCT ON (secret_name) *
       FROM secret_rotation_log
       WHERE next_rotation_due IS NOT NULL
         AND next_rotation_due <= NOW()
         AND status = 'success'
       ORDER BY secret_name, rotated_at DESC`
    );

    return result.rows.map((row) => ({
      id: row.id,
      secretName: row.secret_name,
      secretType: row.secret_type as SecretRotationLog['secretType'],
      rotatedAt: row.rotated_at,
      rotatedBy: row.rotated_by || undefined,
      rotationMethod: row.rotation_method as SecretRotationLog['rotationMethod'],
      oldSecretHash: row.old_secret_hash || undefined,
      newSecretHash: row.new_secret_hash || undefined,
      rotationPolicy: row.rotation_policy || undefined,
      nextRotationDue: row.next_rotation_due || undefined,
      status: row.status as SecretRotationLog['status'],
      errorMessage: row.error_message || undefined,
      metadata: row.metadata as Record<string, unknown> | undefined,
    }));
  }
}

export const secretRotationService = new SecretRotationService();
