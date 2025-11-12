import { createLogger } from '@ai-accountant/shared-utils';
import crypto from 'crypto';

const logger = createLogger('security-service');

// Secrets management (simplified - in production use Vault/KMS)
class SecretsManager {
  private secrets: Map<string, string> = new Map();
  private encryptionKey: Buffer;

  constructor() {
    // In production, load from Vault/KMS
    const key = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    this.encryptionKey = Buffer.from(key, 'hex');
  }

  async getSecret(name: string): Promise<string> {
    // In production, fetch from Vault
    const secret = this.secrets.get(name) || process.env[name] || '';
    
    if (!secret) {
      logger.warn('Secret not found', { name });
    }
    
    return secret;
  }

  async setSecret(name: string, value: string): Promise<void> {
    // In production, store in Vault
    this.secrets.set(name, value);
    logger.info('Secret stored', { name });
  }

  async rotateSecret(name: string): Promise<string> {
    const newValue = crypto.randomBytes(32).toString('hex');
    await this.setSecret(name, newValue);
    logger.info('Secret rotated', { name });
    return newValue;
  }

  encrypt(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(encryptedData: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

export const secretsManager = new SecretsManager();
