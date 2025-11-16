import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('support-service');

export interface KnowledgeBaseArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  views: number;
  helpful: number;
  notHelpful: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SearchResult {
  article: KnowledgeBaseArticle;
  relevanceScore: number;
  matchedTerms: string[];
}

/**
 * Searchable knowledge base engine
 */
export class KnowledgeBaseEngine {
  /**
   * Search articles by query
   */
  async searchArticles(
    query: string,
    category?: string,
    limit = 10
  ): Promise<SearchResult[]> {
    logger.info('Searching knowledge base', { query, category });

    let sqlQuery = `SELECT 
       id, title, content, category, tags, views, helpful, not_helpful,
       created_at, updated_at
     FROM knowledge_base_articles
     WHERE is_published = true`;

    const params: unknown[] = [];
    const conditions: string[] = [];

    // Text search
    if (query) {
      const searchTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const searchConditions = searchTerms.map((term, idx) => {
        params.push(`%${term}%`);
        return `(LOWER(title) LIKE $${params.length} OR LOWER(content) LIKE $${params.length})`;
      });
      conditions.push(`(${searchConditions.join(' AND ')})`);
    }

    // Category filter
    if (category) {
      conditions.push(`category = $${params.length + 1}`);
      params.push(category);
    }

    if (conditions.length > 0) {
      sqlQuery += ' AND ' + conditions.join(' AND ');
    }

    sqlQuery += ' ORDER BY views DESC, updated_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await db.query<{
      id: string;
      title: string;
      content: string;
      category: string;
      tags: string[];
      views: number;
      helpful: number;
      not_helpful: number;
      created_at: Date;
      updated_at: Date;
    }>(sqlQuery, params);

    // Calculate relevance scores
    const searchTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: SearchResult[] = [];

    for (const row of result.rows) {
      const titleLower = row.title.toLowerCase();
      const contentLower = row.content.toLowerCase();
      const tagsLower = (row.tags || []).map(t => t.toLowerCase());

      let relevanceScore = 0;
      const matchedTerms: string[] = [];

      for (const term of searchTerms) {
        if (titleLower.includes(term)) {
          relevanceScore += 10;
          matchedTerms.push(term);
        }
        if (tagsLower.some(t => t.includes(term))) {
          relevanceScore += 5;
          if (!matchedTerms.includes(term)) matchedTerms.push(term);
        }
        if (contentLower.includes(term)) {
          relevanceScore += 1;
          if (!matchedTerms.includes(term)) matchedTerms.push(term);
        }
      }

      // Boost by views and helpfulness
      relevanceScore += Math.log10(row.views + 1) * 0.5;
      relevanceScore += (row.helpful / (row.helpful + row.not_helpful + 1)) * 2;

      results.push({
        article: {
          id: row.id,
          title: row.title,
          content: row.content,
          category: row.category,
          tags: row.tags || [],
          views: row.views,
          helpful: row.helpful,
          notHelpful: row.not_helpful,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
        relevanceScore,
        matchedTerms,
      });
    }

    // Sort by relevance
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return results;
  }

  /**
   * Get article by ID
   */
  async getArticle(articleId: string): Promise<KnowledgeBaseArticle | null> {
    const result = await db.query<{
      id: string;
      title: string;
      content: string;
      category: string;
      tags: string[];
      views: number;
      helpful: number;
      not_helpful: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, title, content, category, tags, views, helpful, not_helpful,
              created_at, updated_at
       FROM knowledge_base_articles
       WHERE id = $1 AND is_published = true`,
      [articleId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    // Increment views
    await db.query(
      `UPDATE knowledge_base_articles
       SET views = views + 1, updated_at = NOW()
       WHERE id = $1`,
      [articleId]
    );

    return {
      id: row.id,
      title: row.title,
      content: row.content,
      category: row.category,
      tags: row.tags || [],
      views: row.views + 1,
      helpful: row.helpful,
      notHelpful: row.not_helpful,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get articles by category
   */
  async getArticlesByCategory(category: string, limit = 20): Promise<KnowledgeBaseArticle[]> {
    const result = await db.query<{
      id: string;
      title: string;
      content: string;
      category: string;
      tags: string[];
      views: number;
      helpful: number;
      not_helpful: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, title, content, category, tags, views, helpful, not_helpful,
              created_at, updated_at
       FROM knowledge_base_articles
       WHERE category = $1 AND is_published = true
       ORDER BY views DESC, updated_at DESC
       LIMIT $2`,
      [category, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      title: row.title,
      content: row.content,
      category: row.category,
      tags: row.tags || [],
      views: row.views,
      helpful: row.helpful,
      notHelpful: row.not_helpful,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Record article feedback
   */
  async recordFeedback(articleId: string, helpful: boolean): Promise<void> {
    if (helpful) {
      await db.query(
        `UPDATE knowledge_base_articles
         SET helpful = helpful + 1, updated_at = NOW()
         WHERE id = $1`,
        [articleId]
      );
    } else {
      await db.query(
        `UPDATE knowledge_base_articles
         SET not_helpful = not_helpful + 1, updated_at = NOW()
         WHERE id = $1`,
        [articleId]
      );
    }
  }
}

// Singleton instance
export const knowledgeBaseEngine = new KnowledgeBaseEngine();
