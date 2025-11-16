import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('support-service');

export interface HelpArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  isPublished: boolean;
  createdBy: UserId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Manage help content and articles
 */
export async function createHelpArticle(
  title: string,
  content: string,
  category: string,
  tags: string[],
  createdBy: UserId,
  isPublished: boolean = false
): Promise<string> {
  const articleId = randomUUID();

  await db.query(
    `INSERT INTO knowledge_base_articles (
      id, title, content, category, tags, is_published,
      created_by, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW(), NOW())`,
    [articleId, title, content, category, JSON.stringify(tags), isPublished, createdBy]
  );

  logger.info('Help article created', { articleId, title, category });

  return articleId;
}

/**
 * Update help article
 */
export async function updateHelpArticle(
  articleId: string,
  updates: {
    title?: string;
    content?: string;
    category?: string;
    tags?: string[];
    isPublished?: boolean;
  }
): Promise<void> {
  const updateFields: string[] = [];
  const params: unknown[] = [];

  if (updates.title !== undefined) {
    updateFields.push(`title = $${params.length + 1}`);
    params.push(updates.title);
  }
  if (updates.content !== undefined) {
    updateFields.push(`content = $${params.length + 1}`);
    params.push(updates.content);
  }
  if (updates.category !== undefined) {
    updateFields.push(`category = $${params.length + 1}`);
    params.push(updates.category);
  }
  if (updates.tags !== undefined) {
    updateFields.push(`tags = $${params.length + 1}::jsonb`);
    params.push(JSON.stringify(updates.tags));
  }
  if (updates.isPublished !== undefined) {
    updateFields.push(`is_published = $${params.length + 1}`);
    params.push(updates.isPublished);
  }

  if (updateFields.length === 0) {
    return;
  }

  updateFields.push('updated_at = NOW()');
  params.push(articleId);

  await db.query(
    `UPDATE knowledge_base_articles
     SET ${updateFields.join(', ')}
     WHERE id = $${params.length}`,
    params
  );

  logger.info('Help article updated', { articleId, updates });
}

/**
 * Delete help article
 */
export async function deleteHelpArticle(articleId: string): Promise<void> {
  await db.query(
    `DELETE FROM knowledge_base_articles
     WHERE id = $1`,
    [articleId]
  );

  logger.info('Help article deleted', { articleId });
}

/**
 * Get all help articles (for admin)
 */
export async function getAllHelpArticles(
  includeUnpublished: boolean = false,
  limit = 100
): Promise<HelpArticle[]> {
  let query = `SELECT 
     id, title, content, category, tags, is_published,
     created_by, created_at, updated_at
   FROM knowledge_base_articles`;

  const params: unknown[] = [];

  if (!includeUnpublished) {
    query += ' WHERE is_published = true';
  }

  query += ' ORDER BY updated_at DESC LIMIT $' + (params.length + 1);
  params.push(limit);

  const result = await db.query<{
    id: string;
    title: string;
    content: string;
    category: string;
    tags: string[];
    is_published: boolean;
    created_by: string;
    created_at: Date;
    updated_at: Date;
  }>(query, params);

  return result.rows.map(row => ({
    id: row.id,
    title: row.title,
    content: row.content,
    category: row.category,
    tags: row.tags || [],
    isPublished: row.is_published,
    createdBy: row.created_by as UserId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
