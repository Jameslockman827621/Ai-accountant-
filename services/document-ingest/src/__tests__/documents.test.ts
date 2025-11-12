import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';
import { uploadDocument, getDocument } from '../services/documents';

describe('Document Ingest Service', () => {
  let testTenantId: string;
  let testUserId: string;

  beforeAll(async () => {
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Doc Tenant', 'GB', 'freelancer')
       RETURNING id`
    );
    testTenantId = tenantResult.rows[0]?.id || '';

    const userResult = await db.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, 'doc@example.com', 'Doc User', 'hash', 'client')
       RETURNING id`,
      [testTenantId]
    );
    testUserId = userResult.rows[0]?.id || '';
  });

  afterAll(async () => {
    if (testTenantId) {
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
    await db.close();
  });

  it('should upload a document', async () => {
    const documentId = await uploadDocument({
      tenantId: testTenantId,
      uploadedBy: testUserId,
      fileName: 'test.pdf',
      fileType: 'application/pdf',
      fileSize: 1024,
      storageKey: 'test-key',
    });

    expect(documentId).toBeDefined();
  });

  it('should retrieve a document', async () => {
    const documentId = await uploadDocument({
      tenantId: testTenantId,
      uploadedBy: testUserId,
      fileName: 'test2.pdf',
      fileType: 'application/pdf',
      fileSize: 2048,
      storageKey: 'test-key-2',
    });

    const document = await getDocument(documentId, testTenantId);
    expect(document).toBeDefined();
    expect(document?.fileName).toBe('test2.pdf');
  });
});
