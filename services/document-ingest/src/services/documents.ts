import { db } from '@ai-accountant/database';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

export interface UploadDocumentInput {
  tenantId: TenantId;
  uploadedBy: UserId;
  fileName: string;
  fileType: string;
  fileSize: number;
  storageKey: string;
}

export interface Document {
  id: string;
  tenantId: TenantId;
  uploadedBy: UserId;
  fileName: string;
  fileType: string;
  fileSize: number;
  storageKey: string;
  status: string;
  createdAt: Date;
}

export async function uploadDocument(input: UploadDocumentInput): Promise<string> {
  const documentId = randomUUID();

  await db.query(
    `INSERT INTO documents (
      id, tenant_id, uploaded_by, file_name, file_type, file_size, storage_key, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploaded')`,
    [
      documentId,
      input.tenantId,
      input.uploadedBy,
      input.fileName,
      input.fileType,
      input.fileSize,
      input.storageKey,
    ]
  );

  return documentId;
}

export async function getDocument(documentId: string, tenantId: TenantId): Promise<Document | null> {
  const result = await db.query<Document>(
    'SELECT * FROM documents WHERE id = $1 AND tenant_id = $2',
    [documentId, tenantId]
  );

  return result.rows[0] || null;
}
