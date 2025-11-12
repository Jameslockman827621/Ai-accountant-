import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('security-service');

export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32;
  private readonly ivLength = 16;
  private readonly tagLength = 16;

  private getKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY || 'default-key-32-characters-long!!';
    return Buffer.from(createHash('sha256').update(key).digest('hex').substring(0, this.keyLength * 2), 'hex');
  }

  encrypt(plaintext: string): string {
    try {
      const key = this.getKey();
      const iv = randomBytes(this.ivLength);
      const cipher = createCipheriv(this.algorithm, key, iv);

      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const tag = cipher.getAuthTag();

      return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
    } catch (error) {
      logger.error('Encryption failed', error instanceof Error ? error : new Error(String(error)));
      throw new Error('Failed to encrypt data');
    }
  }

  decrypt(encrypted: string): string {
    try {
      const [ivHex, tagHex, encryptedText] = encrypted.split(':');
      if (!ivHex || !tagHex || !encryptedText) {
        throw new Error('Invalid encrypted format');
      }

      const key = this.getKey();
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');
      const decipher = createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logger.error('Decryption failed', error instanceof Error ? error : new Error(String(error)));
      throw new Error('Failed to decrypt data');
    }
  }

  encryptField(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    return this.encrypt(value);
  }

  decryptField(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    return this.decrypt(value);
  }
}

export const encryptionService = new EncryptionService();
