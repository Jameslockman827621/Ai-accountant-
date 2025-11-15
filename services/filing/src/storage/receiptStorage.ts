import AWS from 'aws-sdk';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('filing-service');

const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT || process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  accessKeyId: process.env.S3_ACCESS_KEY || process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_KEY || process.env.MINIO_SECRET_KEY || 'minioadmin',
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
});

const RECEIPTS_BUCKET = process.env.FILING_RECEIPTS_BUCKET || 'ai-accountant-filing-receipts';
const RECEIPTS_PREFIX = process.env.FILING_RECEIPTS_PREFIX || 'receipts';

export async function initializeReceiptBucket(): Promise<void> {
  try {
    const exists = await s3
      .headBucket({ Bucket: RECEIPTS_BUCKET })
      .promise()
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      await s3.createBucket({ Bucket: RECEIPTS_BUCKET }).promise();
      logger.info('Created filing receipts bucket', { bucket: RECEIPTS_BUCKET });
    }
  } catch (error) {
    logger.error(
      'Failed to initialize receipt bucket',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

interface StoreReceiptArgs {
  tenantId: string;
  filingId: string;
  submissionId: string;
  payload: Record<string, unknown>;
}

export async function storeReceiptArtifact({
  tenantId,
  filingId,
  submissionId,
  payload,
}: StoreReceiptArgs): Promise<string> {
  const key = `${RECEIPTS_PREFIX}/${tenantId}/${filingId}/${submissionId}/receipt-${Date.now()}.json`;
  const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf-8');

  await s3
    .putObject({
      Bucket: RECEIPTS_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    })
    .promise();

  logger.info('Stored HMRC receipt artifact', { key, tenantId, filingId });
  return key;
}

export function getReceiptDownloadUrl(key: string, expiresInSeconds: number = 3600): string {
  return s3.getSignedUrl('getObject', {
    Bucket: RECEIPTS_BUCKET,
    Key: key,
    Expires: expiresInSeconds,
  });
}
