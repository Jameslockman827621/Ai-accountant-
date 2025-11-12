import request from 'supertest';
import app from '../index';
import { db } from '@ai-accountant/database';
import bcrypt from 'bcrypt';

describe('Document Ingest Service', () => {
  let testTenantId: string = '';
  let testUserId: string = '';
  let authToken: string = '';

  beforeAll(async () => {
    // Create test tenant and user
    const tenantResult = await db.query(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Tenant', 'GB', 'freelancer')
       RETURNING id`
    );
    testTenantId = (tenantResult.rows[0] as { id: string })?.id || '';

    const passwordHash = await bcrypt.hash('testpass123', 10);
    const userResult = await db.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, 'test@example.com', 'Test User', $2, 'client')
       RETURNING id`,
      [testTenantId, passwordHash]
    );
    testUserId = userResult.rows[0]?.id || '';

    // Get auth token
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'testpass123',
      });
    authToken = loginResponse.body.token;
  });

  afterAll(async () => {
    if (testUserId) {
      await db.query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
    if (testTenantId) {
      await db.query('DELETE FROM documents WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
    await db.close();
  });

  describe('POST /api/documents/upload', () => {
    it('should upload a document successfully', async () => {
      const fileContent = Buffer.from('Test PDF content');
      const response = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', fileContent, 'test.pdf');

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('document');
      expect(response.body.document).toHaveProperty('id');
      expect(response.body.document).toHaveProperty('fileName');
    });

    it('should reject upload without file', async () => {
      const response = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(400);
    });

    it('should reject upload without authentication', async () => {
      const fileContent = Buffer.from('Test content');
      const response = await request(app)
        .post('/api/documents/upload')
        .attach('file', fileContent, 'test.pdf');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/documents', () => {
    it('should get documents list', async () => {
      const response = await request(app)
        .get('/api/documents')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('documents');
      expect(response.body).toHaveProperty('pagination');
    });
  });
});
