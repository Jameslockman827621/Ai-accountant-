/**
 * Encryption at Rest for Database
 */

import { createLogger } from '@ai-accountant/shared-utils';
import crypto from 'crypto';

const logger = createLogger('encryption-at-rest');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';

export class EncryptionService {
  private key: Buffer;

  constructor(key?: string) {
    this.key = Buffer.from(key || ENCRYPTION_KEY, 'hex');
    if (this.key.length !== 32) {
      throw new Error('Encryption key must be 32 bytes (64 hex characters)');
    }
  }

  encrypt(text: string): string {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);

      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      // Combine IV, authTag, and encrypted data
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      logger.error('Encryption failed', error);
      throw error;
    }
  }

  decrypt(encryptedData: string): string {
    try {
      const parts = encryptedData.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];

      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logger.error('Decryption failed', error);
      throw error;
    }
  }

  encryptField(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    return this.encrypt(String(value));
  }

  decryptField(encryptedValue: string | null): string | null {
    if (!encryptedValue) {
      return null;
    }
    return this.decrypt(encryptedValue);
  }
}

export const encryptionService = new EncryptionService();

// Database column encryption helpers
export async function encryptSensitiveFields<T extends Record<string, unknown>>(
  data: T,
  fieldsToEncrypt: string[]
): Promise<T> {
  const encrypted = { ...data };
  for (const field of fieldsToEncrypt) {
    if (field in encrypted && encrypted[field] !== null && encrypted[field] !== undefined) {
      encrypted[field] = encryptionService.encryptField(encrypted[field]) as T[Extract<keyof T, string>];
    }
  }
  return encrypted;
}

export async function decryptSensitiveFields<T extends Record<string, unknown>>(
  data: T,
  fieldsToDecrypt: string[]
): Promise<T> {
  const decrypted = { ...data };
  for (const field of fieldsToDecrypt) {
    if (field in decrypted && decrypted[field] !== null && typeof decrypted[field] === 'string') {
      decrypted[field] = encryptionService.decryptField(decrypted[field] as string) as T[Extract<keyof T, string>];
    }
  }
  return decrypted;
}
