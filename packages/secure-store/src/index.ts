import { EncryptedData, decrypt, encrypt } from '@ai-accountant/shared-utils';

export type SecretPayload = EncryptedData;
export interface RotationPolicy {
  maxAgeDays: number;
  createdAt?: string;
  version?: string;
}

export interface ManagedSecret {
  payload: SecretPayload;
  policy: RotationPolicy;
}

function resolveKey(provided?: string): string {
  const key =
    provided ||
    process.env.SECURE_STORE_KEY ||
    process.env.TOKEN_ENCRYPTION_KEY;

  if (key && key.length >= 16) {
    return key;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SECURE_STORE_KEY must be configured in production');
  }

  return 'local-development-secret-key-ai-accountant';
}

function assertSecretPayload(
  payload: SecretPayload | string | null | undefined
): SecretPayload {
  if (!payload) {
    throw new Error('Secret payload is missing');
  }

  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as SecretPayload;
      return assertSecretPayload(parsed);
    } catch (error) {
      throw new Error(
        `Failed to parse encrypted payload string: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    }
  }

  if (
    typeof payload === 'object' &&
    typeof payload.encrypted === 'string' &&
    typeof payload.iv === 'string' &&
    typeof payload.tag === 'string' &&
    typeof payload.salt === 'string'
  ) {
    return payload;
  }

  throw new Error('Invalid encrypted payload format');
}

export function encryptSecret(value: string, key?: string): SecretPayload {
  if (typeof value !== 'string') {
    throw new Error('Only string values can be encrypted');
  }
  return encrypt(value, resolveKey(key));
}

export function decryptSecret(
  payload: SecretPayload | string,
  key?: string
): string {
  const normalized = assertSecretPayload(payload);
  return decrypt(normalized, resolveKey(key));
}

export function encryptSecretAsJson(
  value: string,
  key?: string
): SecretPayload {
  return encryptSecret(value, key);
}

export function decryptSecretFromJson(
  payload: unknown,
  key?: string
): string {
  return decryptSecret(payload as SecretPayload, key);
}

export function stringifySecret(payload: SecretPayload): string {
  return JSON.stringify(payload);
}

export function parseSecret(payload: string): SecretPayload {
  return assertSecretPayload(payload);
}

export function buildManagedSecret(value: string, policy: RotationPolicy, key?: string): ManagedSecret {
  const createdAt = policy.createdAt || new Date().toISOString();
  return {
    payload: encryptSecret(value, key),
    policy: { ...policy, createdAt },
  };
}

export function needsRotation(managed: ManagedSecret, now: Date = new Date()): boolean {
  const created = managed.policy.createdAt ? new Date(managed.policy.createdAt) : now;
  const ageMs = now.getTime() - created.getTime();
  const maxMs = managed.policy.maxAgeDays * 24 * 60 * 60 * 1000;
  return ageMs >= maxMs;
}

export function decryptManagedSecret(managed: ManagedSecret, key?: string): { value: string; rotationDue: boolean } {
  const value = decryptSecret(managed.payload, key);
  return { value, rotationDue: needsRotation(managed) };
}
