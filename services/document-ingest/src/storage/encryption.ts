import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('document-ingest-encryption');

const MAGIC_HEADER = Buffer.from('AIAE'); // AI Accountant Encrypted
const IV_LENGTH = 12; // AES-GCM standard
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // AES-256

let cachedKey: Buffer | null | undefined;

function deriveKeyFromString(source: string): Buffer {
  const candidates = [
    () => Buffer.from(source, 'base64'),
    () => Buffer.from(source, 'hex'),
    () => Buffer.from(source, 'utf8'),
  ];

  for (const candidate of candidates) {
    try {
      const buf = candidate();
      if (buf.length >= KEY_LENGTH) {
        return buf.slice(0, KEY_LENGTH);
      }
      if (buf.length > 0) {
        const padded = Buffer.alloc(KEY_LENGTH);
        buf.copy(padded);
        return padded;
      }
    } catch {
      // Try next encoding strategy
    }
  }

  throw new Error('Provided DOCUMENT_STORAGE_KEY is invalid.');
}

export function getEncryptionKey(): Buffer | null {
  if (cachedKey !== undefined) {
    return cachedKey;
  }

  const keySource = process.env.DOCUMENT_STORAGE_KEY;
  if (!keySource) {
    cachedKey = null;
    logger.warn('DOCUMENT_STORAGE_KEY not configured. Attachments will be stored unencrypted.');
    return cachedKey;
  }

  try {
    cachedKey = deriveKeyFromString(keySource);
    logger.info('Document storage encryption enabled.');
  } catch (error) {
    cachedKey = null;
    logger.error(
      'Failed to initialize document encryption key. Falling back to plaintext storage.',
      error instanceof Error ? error : new Error(String(error))
    );
  }
  return cachedKey;
}

export function encryptBuffer(data: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([MAGIC_HEADER, iv, authTag, encrypted]);
}

export function decryptBuffer(data: Buffer, key: Buffer): Buffer {
  if (!isEncryptedBuffer(data)) {
    return data;
  }

  const ivStart = MAGIC_HEADER.length;
  const authTagStart = ivStart + IV_LENGTH;
  const ciphertextStart = authTagStart + AUTH_TAG_LENGTH;

  const iv = data.slice(ivStart, authTagStart);
  const authTag = data.slice(authTagStart, ciphertextStart);
  const ciphertext = data.slice(ciphertextStart);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function isEncryptedBuffer(data: Buffer): boolean {
  if (data.length < MAGIC_HEADER.length) {
    return false;
  }
  return data.slice(0, MAGIC_HEADER.length).equals(MAGIC_HEADER);
}
