/**
 * Encryption Service
 * Handles encryption at rest and in transit
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { createLogger } from '@ai-accountant/shared-utils';
import { secretManager } from './secrets';

const logger = createLogger('encryption');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;

/**
 * Get encryption key from secrets manager
 */
async function getEncryptionKey(): Promise<Buffer> {
  const keyString = await secretManager.getSecret('ENCRYPTION_KEY', {
    envVar: 'ENCRYPTION_KEY',
  });

  // Derive 32-byte key from string
  return createHash('sha256').update(keyString).digest();
}

/**
 * Encrypt data
 */
export async function encrypt(data: string): Promise<string> {
  try {
    const key = await getEncryptionKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    // Return: iv:tag:encrypted
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
  } catch (error) {
    logger.error('Encryption failed', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt data
 */
export async function decrypt(encryptedData: string): Promise<string> {
  try {
    const key = await getEncryptionKey();
    const parts = encryptedData.split(':');

    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const [ivHex, tagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    logger.error('Decryption failed', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Encrypt sensitive fields in an object
 */
export async function encryptObject<T extends Record<string, unknown>>(
  obj: T,
  fieldsToEncrypt: (keyof T)[]
): Promise<T> {
  const encrypted = { ...obj };

  for (const field of fieldsToEncrypt) {
    if (encrypted[field] && typeof encrypted[field] === 'string') {
      encrypted[field] = (await encrypt(encrypted[field] as string)) as T[keyof T];
    }
  }

  return encrypted;
}

/**
 * Decrypt sensitive fields in an object
 */
export async function decryptObject<T extends Record<string, unknown>>(
  obj: T,
  fieldsToDecrypt: (keyof T)[]
): Promise<T> {
  const decrypted = { ...obj };

  for (const field of fieldsToDecrypt) {
    if (decrypted[field] && typeof decrypted[field] === 'string') {
      try {
        decrypted[field] = (await decrypt(decrypted[field] as string)) as T[keyof T];
      } catch (error) {
        logger.warn(`Failed to decrypt field ${String(field)}`, error);
      }
    }
  }

  return decrypted;
}

/**
 * Hash data (one-way, for passwords, etc.)
 */
export function hash(data: string, salt?: string): { hash: string; salt: string } {
  const usedSalt = salt || randomBytes(SALT_LENGTH).toString('hex');
  const hash = createHash('sha256').update(data + usedSalt).digest('hex');
  return { hash, salt: usedSalt };
}

/**
 * Verify hash
 */
export function verifyHash(data: string, hash: string, salt: string): boolean {
  const computed = createHash('sha256').update(data + salt).digest('hex');
  return computed === hash;
}
