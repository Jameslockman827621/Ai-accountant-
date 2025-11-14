import { db } from '@ai-accountant/database';
import { TenantId, UserId, UserRole } from '@ai-accountant/shared-types';
import { randomUUID, createHash } from 'crypto';

export interface CreateUserInput {
  tenantId: TenantId;
  email: string;
  name: string;
  password: string;
  role: UserRole;
}

export interface AuthResult {
  user: {
    id: UserId;
    email: string;
    name: string;
    role: UserRole;
    tenantId: TenantId;
  };
  token: string;
}

function hashPassword(password: string): Promise<string> {
  const hash = createHash('sha256').update(password).digest('hex');
  return Promise.resolve(hash);
}

function verifyPassword(password: string, hash: string): Promise<boolean> {
  const candidate = createHash('sha256').update(password).digest('hex');
  return Promise.resolve(candidate === hash);
}

export async function createUser(input: CreateUserInput): Promise<UserId> {
  const userId = randomUUID();
  const passwordHash = await hashPassword(input.password);

  await db.query(
    `INSERT INTO users (id, tenant_id, email, name, password_hash, role)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, input.tenantId, input.email, input.name, passwordHash, input.role]
  );

  return userId;
}

export async function authenticateUser(email: string, password: string): Promise<AuthResult> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    email: string;
    name: string;
    role: string;
    password_hash: string;
  }>(
    'SELECT id, tenant_id, email, name, role, password_hash FROM users WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    throw new Error('Invalid credentials');
  }

  const user = result.rows[0];
  if (!user) {
    throw new Error('Invalid credentials');
  }
  const isValid = await verifyPassword(password, user.password_hash);

  if (!isValid) {
    throw new Error('Invalid credentials');
  }

  // Generate token (simplified - in production use proper JWT)
  const token = `token-${user.id}`;

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      tenantId: user.tenant_id,
    },
    token,
  };
}
