import AWS from 'aws-sdk';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('filing-evidence-storage');

const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT || process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  accessKeyId: process.env.S3_ACCESS_KEY || process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_KEY || process.env.MINIO_SECRET_KEY || 'minioadmin',
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
});

const BUCKET = process.env.FILING_EVIDENCE_BUCKET || 'ai-accountant-filing-evidence';
const PREFIX = process.env.FILING_EVIDENCE_PREFIX || 'evidence';

export async function initializeEvidenceBucket(): Promise<void> {
  try {
    const exists = await s3
      .headBucket({ Bucket: BUCKET })
      .promise()
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      await s3.createBucket({ Bucket: BUCKET }).promise();
      logger.info('Created filing evidence bucket', { bucket: BUCKET });
    }
  } catch (error) {
    logger.error(
      'Failed to initialize evidence bucket',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export async function storeEvidenceBundle(args: {
  tenantId: string;
  filingId: string;
  buffer: Buffer;
  contentType?: string;
}): Promise<string> {
  const key = `${PREFIX}/${args.tenantId}/${args.filingId}/bundle-${Date.now()}.zip`;

  await s3
    .putObject({
      Bucket: BUCKET,
      Key: key,
      Body: args.buffer,
      ContentType: args.contentType ?? 'application/zip',
    })
    .promise();

  logger.info('Stored filing evidence bundle', { key, filingId: args.filingId });
  return key;
}

export function getEvidenceDownloadUrl(key: string, expiresInSeconds: number = 3600): string {
  return s3.getSignedUrl('getObject', {
    Bucket: BUCKET,
    Key: key,
    Expires: expiresInSeconds,
  });
}
