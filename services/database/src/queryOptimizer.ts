/**
 * Database Query Optimization Utilities
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { db } from './index';

const logger = createLogger('query-optimizer');

export interface QueryPlan {
  query: string;
  executionTime: number;
  rowsExamined: number;
  rowsReturned: number;
  indexUsed?: string;
  recommendations: string[];
}

export interface IndexRecommendation {
  table: string;
  columns: string[];
  type: 'btree' | 'hash' | 'gin' | 'gist';
  reason: string;
}

/**
 * Analyze query performance
 */
export async function analyzeQuery(query: string, params?: unknown[]): Promise<QueryPlan> {
  const startTime = Date.now();

  try {
    // Get execution plan
    const explainQuery = `EXPLAIN ANALYZE ${query}`;
    const planResult = await db.query(explainQuery, params);

    const executionTime = Date.now() - startTime;
    const planText = planResult.rows.map((r: any) => r['QUERY PLAN'] || JSON.stringify(r)).join('\n');

    // Parse plan for recommendations
    const recommendations = parsePlanForRecommendations(planText);

    // Execute actual query to get row counts
    const result = await db.query(query, params);

    return {
      query,
      executionTime,
      rowsExamined: estimateRowsExamined(planText),
      rowsReturned: result.rowCount || 0,
      indexUsed: extractIndexUsed(planText),
      recommendations,
    };
  } catch (error) {
    logger.error('Query analysis failed', error);
    throw error;
  }
}

/**
 * Get index recommendations for slow queries
 */
export async function getIndexRecommendations(
  slowQueryThreshold: number = 1000
): Promise<IndexRecommendation[]> {
  try {
    // Query pg_stat_statements for slow queries
    const result = await db.query<{
      query: string;
      mean_exec_time: number;
      calls: number;
    }>(
      `SELECT 
        query,
        mean_exec_time,
        calls
      FROM pg_stat_statements
      WHERE mean_exec_time > $1
      ORDER BY mean_exec_time DESC
      LIMIT 10`,
      [slowQueryThreshold]
    );

    const recommendations: IndexRecommendation[] = [];

    for (const row of result.rows) {
      const recs = analyzeQueryForIndexes(row.query);
      recommendations.push(...recs);
    }

    return recommendations;
  } catch (error) {
    logger.warn('pg_stat_statements not available', error);
    return [];
  }
}

/**
 * Create recommended indexes
 */
export async function createRecommendedIndexes(
  recommendations: IndexRecommendation[]
): Promise<void> {
  for (const rec of recommendations) {
    try {
      const indexName = `idx_${rec.table}_${rec.columns.join('_')}`;
      const columns = rec.columns.join(', ');

      await db.query(
        `CREATE INDEX IF NOT EXISTS ${indexName} ON ${rec.table} USING ${rec.type} (${columns})`
      );

      logger.info('Index created', { indexName, table: rec.table });
    } catch (error) {
      logger.error('Failed to create index', error, { recommendation: rec });
    }
  }
}

/**
 * Optimize table (VACUUM, ANALYZE)
 */
export async function optimizeTable(tableName: string): Promise<void> {
  try {
    await db.query(`VACUUM ANALYZE ${tableName}`);
    logger.info('Table optimized', { table: tableName });
  } catch (error) {
    logger.error('Failed to optimize table', error, { table: tableName });
  }
}

/**
 * Get table statistics
 */
export async function getTableStats(tableName: string): Promise<{
  rowCount: number;
  tableSize: string;
  indexSize: string;
  totalSize: string;
}> {
  const result = await db.query<{
    row_count: string;
    table_size: string;
    index_size: string;
    total_size: string;
  }>(
    `SELECT 
      n_live_tup::text as row_count,
      pg_size_pretty(pg_total_relation_size($1::regclass)) as total_size,
      pg_size_pretty(pg_relation_size($1::regclass)) as table_size,
      pg_size_pretty(pg_total_relation_size($1::regclass) - pg_relation_size($1::regclass)) as index_size
    FROM pg_stat_user_tables
    WHERE relname = $1`,
    [tableName]
  );

  if (result.rows.length === 0) {
    throw new Error(`Table ${tableName} not found`);
  }

  return {
    rowCount: parseInt(result.rows[0].row_count, 10),
    tableSize: result.rows[0].table_size,
    indexSize: result.rows[0].index_size,
    totalSize: result.rows[0].total_size,
  };
}

function parsePlanForRecommendations(planText: string): string[] {
  const recommendations: string[] = [];

  // Check for sequential scans
  if (planText.includes('Seq Scan')) {
    recommendations.push('Consider adding an index to avoid sequential scan');
  }

  // Check for high cost
  const costMatch = planText.match(/cost=(\d+\.\d+)\.\.(\d+\.\d+)/);
  if (costMatch) {
    const maxCost = parseFloat(costMatch[2]);
    if (maxCost > 1000) {
      recommendations.push(`High query cost (${maxCost.toFixed(2)}). Consider optimization.`);
    }
  }

  // Check for missing indexes
  if (planText.includes('Filter:') && !planText.includes('Index')) {
    recommendations.push('Query uses filter without index. Consider adding index on filtered columns.');
  }

  return recommendations;
}

function estimateRowsExamined(planText: string): number {
  const rowsMatch = planText.match(/rows=(\d+)/);
  if (rowsMatch) {
    return parseInt(rowsMatch[1], 10);
  }
  return 0;
}

function extractIndexUsed(planText: string): string | undefined {
  const indexMatch = planText.match(/Index.*?\((\w+)\)/);
  return indexMatch ? indexMatch[1] : undefined;
}

function analyzeQueryForIndexes(query: string): IndexRecommendation[] {
  const recommendations: IndexRecommendation[] = [];

  // Simple heuristic: look for WHERE clauses
  const whereMatch = query.match(/WHERE\s+(\w+)\s*[=<>]/i);
  if (whereMatch) {
    const tableMatch = query.match(/FROM\s+(\w+)/i);
    if (tableMatch) {
      recommendations.push({
        table: tableMatch[1],
        columns: [whereMatch[1]],
        type: 'btree',
        reason: 'Frequently filtered column',
      });
    }
  }

  return recommendations;
}
