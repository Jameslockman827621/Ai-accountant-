// Re-export from document-ingest service
// In production, this would be a shared package
import AWS from 'aws-sdk';

const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
});

const BUCKET_NAME = process.env.S3_BUCKET || 'ai-accountant-documents';

export async function getFile(key: string): Promise<Buffer> {
  try {
    const result = await s3
      .getObject({
        Bucket: BUCKET_NAME,
        Key: key,
      })
      .promise();

    return Buffer.from(result.Body as string);
  } catch (error) {
    throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
