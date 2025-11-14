import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('document-ingest-service');

/**
 * Full-text search across documents with ranking
 */
export async function searchDocuments(
  tenantId: TenantId,
  query: string,
  filters?: {
    documentType?: string;
    dateFrom?: Date;
    dateTo?: Date;
    minConfidence?: number;
  },
  limit: number = 50
): Promise<Array<{
  id: string;
  fileName: string;
  documentType: string | null;
  relevance: number;
  matchedFields: string[];
  snippet: string;
}>> {
  logger.info('Searching documents', { tenantId, query });

  // Build search query with full-text search
  let sqlQuery = `
    SELECT 
      id,
      file_name,
      document_type,
      extracted_data,
      confidence_score,
      created_at,
      ts_rank(
        to_tsvector('english', COALESCE(file_name, '') || ' ' || COALESCE(extracted_data::text, '')),
        plainto_tsquery('english', $1)
      ) as relevance
    FROM documents
    WHERE tenant_id = $2
      AND (
        to_tsvector('english', COALESCE(file_name, '') || ' ' || COALESCE(extracted_data::text, ''))
        @@ plainto_tsquery('english', $1)
      )
  `;

  const params: unknown[] = [query, tenantId];
  let paramIndex = 3;

  if (filters?.documentType) {
    sqlQuery += ` AND document_type = $${paramIndex++}`;
    params.push(filters.documentType);
  }

  if (filters?.dateFrom) {
    sqlQuery += ` AND created_at >= $${paramIndex++}`;
    params.push(filters.dateFrom);
  }

  if (filters?.dateTo) {
    sqlQuery += ` AND created_at <= $${paramIndex++}`;
    params.push(filters.dateTo);
  }

  if (filters?.minConfidence) {
    sqlQuery += ` AND confidence_score >= $${paramIndex++}`;
    params.push(filters.minConfidence);
  }

  sqlQuery += ` ORDER BY relevance DESC LIMIT $${paramIndex++}`;
  params.push(limit);

  const result = await db.query<{
    id: string;
    file_name: string;
    document_type: string | null;
    extracted_data: unknown;
    confidence_score: number | null;
    relevance: number;
  }>(sqlQuery, params);

  // Generate snippets and matched fields
  return result.rows.map(row => {
    const extracted = row.extracted_data as Record<string, unknown> | null;
    const text = `${row.file_name} ${extracted ? JSON.stringify(extracted) : ''}`;
    const snippet = generateSnippet(text, query, 200);
    const matchedFields = findMatchedFields(row, query);

    return {
      id: row.id,
      fileName: row.file_name,
      documentType: row.document_type,
      relevance: typeof row.relevance === 'number' ? row.relevance : 0,
      matchedFields,
      snippet,
    };
  });
}

function generateSnippet(text: string, query: string, maxLength: number): string {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) {
    return text.substring(0, maxLength) + '...';
  }

  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + query.length + 50);
  let snippet = text.substring(start, end);

  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  return snippet;
}

function findMatchedFields(
  document: {
    file_name: string;
    extracted_data: unknown;
  },
  query: string
): string[] {
  const matched: string[] = [];
  const lowerQuery = query.toLowerCase();

  if (document.file_name.toLowerCase().includes(lowerQuery)) {
    matched.push('fileName');
  }

  const extracted = document.extracted_data as Record<string, unknown> | null;
  if (extracted) {
    Object.entries(extracted).forEach(([key, value]) => {
      if (String(value).toLowerCase().includes(lowerQuery)) {
        matched.push(key);
      }
    });
  }

  return matched;
}

/**
 * Create full-text search index
 */
export async function createSearchIndex(tenantId: TenantId): Promise<void> {
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_documents_fulltext_search
    ON documents
    USING gin(to_tsvector('english', COALESCE(file_name, '') || ' ' || COALESCE(extracted_data::text, '')))
    WHERE tenant_id = $1
  `, [tenantId]);

  logger.info('Search index created', { tenantId });
}
