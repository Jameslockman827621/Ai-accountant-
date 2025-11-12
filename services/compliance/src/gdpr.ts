import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('compliance-service');

// Enhanced GDPR Compliance
export class GDPRCompliance {
  // Right to Access
  async exportUserData(userId: UserId): Promise<Record<string, unknown>> {
    logger.info('Exporting user data', { userId });

    const userData = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    const documents = await db.query(
      'SELECT * FROM documents WHERE uploaded_by = $1',
      [userId]
    );

    return {
      user: userData.rows[0],
      documents: documents.rows,
      exportedAt: new Date().toISOString(),
    };
  }

  // Right to Erasure
  async deleteUserData(userId: UserId): Promise<void> {
    logger.info('Deleting user data', { userId });

    // Anonymize instead of delete for audit purposes
    await db.query(
      `UPDATE users
       SET email = 'deleted@example.com',
           name = 'Deleted User',
           password_hash = '',
           is_active = false
       WHERE id = $1`,
      [userId]
    );

    await db.query(
      `UPDATE documents
       SET file_name = 'deleted',
           storage_key = ''
       WHERE uploaded_by = $1`,
      [userId]
    );
  }

  // Consent Management
  async recordConsent(
    userId: UserId,
    consentType: string,
    granted: boolean
  ): Promise<void> {
    await db.query(
      `INSERT INTO consent_records (
        user_id, consent_type, granted, timestamp
      ) VALUES ($1, $2, $3, NOW())`,
      [userId, consentType, granted]
    );
  }

  // Data Minimization
  async anonymizeOldData(tenantId: TenantId, olderThanDays: number = 2555): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db.query<{ count: string | number }>(
      `UPDATE documents
       SET extracted_data = jsonb_set(extracted_data, '{anonymized}', 'true'::jsonb)
       WHERE tenant_id = $1
         AND created_at < $2
         AND (extracted_data->>'anonymized')::boolean IS NOT TRUE
       RETURNING COUNT(*) as count`,
      [tenantId, cutoffDate]
    );

    const count = typeof result.rows[0]?.count === 'number'
      ? result.rows[0].count
      : parseInt(String(result.rows[0]?.count || '0'), 10);

    logger.info('Data anonymized', { tenantId, count });
    return count;
  }
}

export const gdprCompliance = new GDPRCompliance();
