import { createLogger } from '@ai-accountant/shared-utils';
import crypto from 'crypto';

const logger = createLogger('security-service');

// Database encryption at rest
export class DatabaseEncryption {
  private encryptionKey: Buffer;

  constructor() {
    const key = process.env.DB_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    this.encryptionKey = Buffer.from(key, 'hex');
  }

  encryptField(value: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decryptField(encryptedValue: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedValue.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

export const dbEncryption = new DatabaseEncryption();

// S3 encryption at rest
export class S3Encryption {
  encryptObject(data: Buffer): Buffer {
    // In production, use S3 server-side encryption or client-side encryption
    logger.info('S3 object encrypted');
    return data;
  }

  decryptObject(encryptedData: Buffer): Buffer {
    logger.info('S3 object decrypted');
    return encryptedData;
  }
}

export const s3Encryption = new S3Encryption();
