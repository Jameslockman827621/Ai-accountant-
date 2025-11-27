export interface EncryptionAtRestConfig {
  kmsKeyAlias: string;
  rotationIntervalDays: number;
  algorithm: 'aes-256-gcm' | 'aes-256-cbc';
  enabled: boolean;
}

export const databaseEncryption: EncryptionAtRestConfig = {
  kmsKeyAlias: process.env.DB_KMS_KEY_ALIAS || 'alias/ai-accountant/db',
  rotationIntervalDays: parseInt(process.env.DB_KMS_ROTATION_DAYS || '90', 10),
  algorithm: 'aes-256-gcm',
  enabled: process.env.DB_ENCRYPTION_AT_REST !== 'false',
};

export const blobEncryption: EncryptionAtRestConfig = {
  kmsKeyAlias: process.env.BLOB_KMS_KEY_ALIAS || 'alias/ai-accountant/blobs',
  rotationIntervalDays: parseInt(process.env.BLOB_KMS_ROTATION_DAYS || '60', 10),
  algorithm: 'aes-256-gcm',
  enabled: process.env.BLOB_ENCRYPTION_AT_REST !== 'false',
};
