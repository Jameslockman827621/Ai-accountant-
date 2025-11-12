import { createLogger } from '@ai-accountant/shared-utils';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const logger = createLogger('security-service');

// Simplified secrets management - in production, use HashiCorp Vault or AWS KMS
class SecretsManager {
  private encryptionKey: Buffer;

  constructor() {
    // In production, get from environment or Vault
    const key = process.env.ENCRYPTION_KEY || 'default-encryption-key-32-chars!!';
    this.encryptionKey = Buffer.from(key.padEnd(32, '0').substring(0, 32));
  }

  encrypt(plaintext: string): string {
    try {
      const iv = randomBytes(16);
      const cipher = createCipheriv('aes-256-cbc', this.encryptionKey, iv);
      
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return `${iv.toString('hex')}:${encrypted}`;
    } catch (error) {
      logger.error('Encryption failed', error instanceof Error ? error : new Error(String(error)));
      throw new Error('Failed to encrypt secret');
    }
  }

  decrypt(encrypted: string): string {
    try {
      const [ivHex, encryptedText] = encrypted.split(':');
      if (!ivHex || !encryptedText) {
        throw new Error('Invalid encrypted format');
      }

      const iv = Buffer.from(ivHex, 'hex');
      const decipher = createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
      
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logger.error('Decryption failed', error instanceof Error ? error : new Error(String(error)));
      throw new Error('Failed to decrypt secret');
    }
  }

  hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }
}

export const secretsManager = new SecretsManager();

export async function storeSecret(key: string, value: string): Promise<void> {
  const encrypted = secretsManager.encrypt(value);
  
  // In production, store in Vault or secure storage
  process.env[`SECRET_${key}`] = encrypted;
  
  logger.info('Secret stored', { key });
}

export async function retrieveSecret(key: string): Promise<string> {
  const encrypted = process.env[`SECRET_${key}`];
  if (!encrypted) {
    throw new Error(`Secret not found: ${key}`);
  }

  return secretsManager.decrypt(encrypted);
}

export function rotateSecret(key: string): Promise<void> {
  // In production, implement proper secret rotation
  logger.info('Secret rotation requested', { key });
  return Promise.resolve();
}
