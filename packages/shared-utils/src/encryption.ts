import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface EncryptedData {
  encrypted: string;
  iv: string;
  tag: string;
  salt: string;
}

/**
 * Derives a key from a password using PBKDF2
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, 'sha512');
}

/**
 * Encrypts data using AES-256-GCM
 */
export function encrypt(data: string, password: string): EncryptedData {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    salt: salt.toString('hex'),
  };
}

/**
 * Decrypts data using AES-256-GCM
 */
export function decrypt(encryptedData: EncryptedData, password: string): string {
  const salt = Buffer.from(encryptedData.salt, 'hex');
  const key = deriveKey(password, salt);
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const tag = Buffer.from(encryptedData.tag, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Hashes data using SHA-256
 */
export function hash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
