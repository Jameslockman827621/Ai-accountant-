import AWS from 'aws-sdk';
import { createLogger } from '@ai-accountant/shared-utils';
import { decryptBuffer, encryptBuffer, getEncryptionKey } from './encryption';

const logger = createLogger('document-ingest-service');

const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
});

const BUCKET_NAME = process.env.S3_BUCKET || 'ai-accountant-documents';
const encryptionKey = getEncryptionKey();
const encryptionEnabled = Boolean(encryptionKey);

export async function uploadFile(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  try {
    const payload =
      encryptionEnabled && encryptionKey
        ? encryptBuffer(buffer, encryptionKey)
        : buffer;

    await s3
      .putObject({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: payload,
        ContentType: contentType,
        Metadata: encryptionEnabled ? { 'x-ai-encrypted': 'true' } : undefined,
      })
      .promise();

    logger.info('File uploaded to S3', { key, contentType });
    return key;
  } catch (error) {
    logger.error('S3 upload failed', error instanceof Error ? error : new Error(String(error)), { key });
    throw new Error(`Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function getFile(key: string): Promise<Buffer> {
  try {
    const result = await s3
      .getObject({
        Bucket: BUCKET_NAME,
        Key: key,
      })
      .promise();

    if (!result.Body) {
      throw new Error('Object body is empty');
    }

    const rawBuffer = (() => {
      if (Buffer.isBuffer(result.Body)) {
        return result.Body;
      }
      if (typeof result.Body === 'string') {
        return Buffer.from(result.Body);
      }
      if (result.Body instanceof Uint8Array) {
        return Buffer.from(result.Body);
      }
      throw new Error('Unsupported object body type');
    })();

    if (encryptionEnabled && encryptionKey) {
      return decryptBuffer(rawBuffer, encryptionKey);
    }

    return rawBuffer;
  } catch (error) {
    logger.error('S3 download failed', error instanceof Error ? error : new Error(String(error)), { key });
    throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function deleteFile(key: string): Promise<void> {
  try {
    await s3
      .deleteObject({
        Bucket: BUCKET_NAME,
        Key: key,
      })
      .promise();

    logger.info('File deleted from S3', { key });
  } catch (error) {
    logger.error('S3 delete failed', error instanceof Error ? error : new Error(String(error)), { key });
    throw new Error(`Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function getSignedUrl(key: string, expiresIn: number = 3600): string {
  return s3.getSignedUrl('getObject', {
    Bucket: BUCKET_NAME,
    Key: key,
    Expires: expiresIn,
  });
}

// Initialize bucket if it doesn't exist
export async function initializeBucket(): Promise<void> {
  try {
    const exists = await s3.headBucket({ Bucket: BUCKET_NAME }).promise().then(() => true).catch(() => false);
    if (!exists) {
      await s3.createBucket({ Bucket: BUCKET_NAME }).promise();
      logger.info('S3 bucket created', { bucket: BUCKET_NAME });
    }
  } catch (error) {
    logger.error('S3 bucket initialization failed', error instanceof Error ? error : new Error(String(error)));
  }
}
