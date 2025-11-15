import { EncryptedData, decrypt, encrypt } from '@ai-accountant/shared-utils';

export type SecretPayload = EncryptedData;

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
