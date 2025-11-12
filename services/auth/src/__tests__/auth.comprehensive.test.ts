import request from 'supertest';
import app from '../index';
import { db } from '@ai-accountant/database';
import bcrypt from 'bcrypt';

describe('Auth Service - Comprehensive Tests', () => {
  let testTenantId: string = '';
  let testUserId: string = '';
  let authToken: string = '';

  beforeAll(async () => {
    // Create test tenant
    const tenantResult = await db.query(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Tenant', 'GB', 'freelancer')
       RETURNING id`
    );
    testTenantId = (tenantResult.rows[0] as { id: string })?.id || '';

    // Create test user
    const passwordHash = await bcrypt.hash('testpass123', 10);
    const userResult = await db.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, 'test@example.com', 'Test User', $2, 'client')
       RETURNING id`,
      [testTenantId, passwordHash]
    );
    testUserId = (userResult.rows[0] as { id: string })?.id || '';
  });

  afterAll(async () => {
    if (testUserId) {
      await db.query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
    if (testTenantId) {
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
    await db.close();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user and tenant successfully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'password123',
          name: 'New User',
          tenantName: 'New Company',
          country: 'GB',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('tenant');
      expect(response.body.user.email).toBe('newuser@example.com');

      // Cleanup
      if (response.body.user?.id) {
        await db.query('DELETE FROM users WHERE id = $1', [response.body.user.id]);
      }
      if (response.body.tenant?.id) {
        await db.query('DELETE FROM tenants WHERE id = $1', [response.body.tenant.id]);
      }
    });

    it('should reject registration with invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'password123',
          name: 'Test',
          tenantName: 'Test',
          country: 'GB',
        });

      expect(response.status).toBe(400);
    });

    it('should reject registration with weak password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: '123',
          name: 'Test',
          tenantName: 'Test',
          country: 'GB',
        });

      expect(response.status).toBe(400);
    });

    it('should reject registration with missing fields', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          // Missing password, name, etc.
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'testpass123',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      authToken = response.body.token;
    });

    it('should reject login with invalid password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword',
        });

      expect(response.status).toBe(400);
    });

    it('should reject login with non-existent email', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should get current user with valid token', async () => {
      if (!authToken) {
        const loginResponse = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'test@example.com',
            password: 'testpass123',
          });
        authToken = loginResponse.body.token;
      }

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe('test@example.com');
    });

    it('should reject request without token', async () => {
      const response = await request(app).get('/api/auth/me');

      expect(response.status).toBe(401);
    });

    it('should reject request with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/users', () => {
    it('should get users in tenant', async () => {
      if (!authToken) {
        const loginResponse = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'test@example.com',
            password: 'testpass123',
          });
        authToken = loginResponse.body.token;
      }

      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('users');
      expect(Array.isArray(response.body.users)).toBe(true);
    });
  });
});
