#!/usr/bin/env ts-node
/**
 * Load testing script for reconciliation service
 * Usage: ts-node scripts/performance/load-test-reconciliation.ts
 */

import { db } from '../../services/database/src/index';
import { intelligentMatchingService } from '../../services/reconciliation/src/services/intelligentMatching';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('load-test-reconciliation');

interface PerformanceMetrics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  minLatency: number;
  maxLatency: number;
  operationsPerSecond: number;
}

async function measureOperation<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<{ result: T; latency: number }> {
  const start = Date.now();
  try {
    const result = await operation();
    const latency = Date.now() - start;
    return { result, latency };
  } catch (error) {
    const latency = Date.now() - start;
    logger.error(`Operation failed: ${operationName}`, {
      error: error instanceof Error ? error : new Error(String(error)),
      latency,
    });
    throw error;
  }
}

async function runLoadTest(
  tenantId: TenantId,
  options: {
    numTransactions: number;
    numDocuments: number;
    concurrency: number;
  }
): Promise<PerformanceMetrics> {
  logger.info('Starting load test', { tenantId, options });

  // Create test data
  const bankTransactionIds: string[] = [];
  const documentIds: string[] = [];

  logger.info('Creating test data...');

  // Create bank transactions
  for (let i = 0; i < options.numTransactions; i++) {
    const txId = randomUUID();
    await db.query(
      `INSERT INTO bank_transactions (
        id, tenant_id, account_id, transaction_id, date, amount, currency,
        description, category, reconciled, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
      [
        txId,
        tenantId,
        randomUUID(),
        `TXN${i}`,
        new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000),
        100 + Math.random() * 900,
        'GBP',
        `Test Transaction ${i}`,
        'expense',
        false,
      ]
    );
    bankTransactionIds.push(txId);
  }

  // Create documents
  for (let i = 0; i < options.numDocuments; i++) {
    const docId = randomUUID();
    await db.query(
      `INSERT INTO documents (
        id, tenant_id, file_name, file_type, status, extracted_data,
        confidence_score, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW(), NOW())`,
      [
        docId,
        tenantId,
        `test-doc-${i}.pdf`,
        'application/pdf',
        'extracted',
        JSON.stringify({
          total: 100 + Math.random() * 900,
          date: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
          vendor: `Vendor ${i}`,
          description: `Test Document ${i}`,
        }),
        0.8 + Math.random() * 0.2,
      ]
    );
    documentIds.push(docId);
  }

  logger.info('Test data created', {
    transactions: bankTransactionIds.length,
    documents: documentIds.length,
  });

  // Run load test
  const latencies: number[] = [];
  let successful = 0;
  let failed = 0;
  const startTime = Date.now();

  logger.info('Running load test...');

  // Process in batches with concurrency
  const batchSize = options.concurrency;
  for (let i = 0; i < bankTransactionIds.length; i += batchSize) {
    const batch = bankTransactionIds.slice(i, i + batchSize);
    const batchPromises = batch.map(async (txId) => {
      try {
        const { latency } = await measureOperation(
          () => intelligentMatchingService.findMatches(tenantId, txId),
          `findMatches-${txId}`
        );
        latencies.push(latency);
        successful++;
      } catch (error) {
        failed++;
        logger.error('Match operation failed', {
          txId,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    });

    await Promise.all(batchPromises);
  }

  const endTime = Date.now();
  const totalTime = (endTime - startTime) / 1000; // seconds

  // Calculate metrics
  latencies.sort((a, b) => a - b);
  const totalLatency = latencies.reduce((sum, l) => sum + l, 0);

  const metrics: PerformanceMetrics = {
    totalOperations: bankTransactionIds.length,
    successfulOperations: successful,
    failedOperations: failed,
    averageLatency: latencies.length > 0 ? totalLatency / latencies.length : 0,
    p50Latency: latencies[Math.floor(latencies.length * 0.5)] || 0,
    p95Latency: latencies[Math.floor(latencies.length * 0.95)] || 0,
    p99Latency: latencies[Math.floor(latencies.length * 0.99)] || 0,
    minLatency: latencies[0] || 0,
    maxLatency: latencies[latencies.length - 1] || 0,
    operationsPerSecond: totalTime > 0 ? successful / totalTime : 0,
  };

  // Cleanup test data
  logger.info('Cleaning up test data...');
  await db.query('DELETE FROM bank_transactions WHERE tenant_id = $1 AND transaction_id LIKE $2', [
    tenantId,
    'TXN%',
  ]);
  await db.query('DELETE FROM documents WHERE tenant_id = $1 AND file_name LIKE $2', [
    tenantId,
    'test-doc-%',
  ]);

  return metrics;
}

async function main() {
  const testTenantId = process.env.TEST_TENANT_ID || (await getOrCreateTestTenant());

  const options = {
    numTransactions: parseInt(process.env.NUM_TRANSACTIONS || '100', 10),
    numDocuments: parseInt(process.env.NUM_DOCUMENTS || '50', 10),
    concurrency: parseInt(process.env.CONCURRENCY || '10', 10),
  };

  logger.info('Load test configuration', { testTenantId, options });

  try {
    const metrics = await runLoadTest(testTenantId as TenantId, options);

    logger.info('Load test completed', metrics);

    // Print results
    console.log('\n=== Load Test Results ===');
    console.log(`Total Operations: ${metrics.totalOperations}`);
    console.log(`Successful: ${metrics.successfulOperations}`);
    console.log(`Failed: ${metrics.failedOperations}`);
    console.log(`Success Rate: ${((metrics.successfulOperations / metrics.totalOperations) * 100).toFixed(2)}%`);
    console.log(`\nLatency Metrics:`);
    console.log(`  Average: ${metrics.averageLatency.toFixed(2)}ms`);
    console.log(`  P50: ${metrics.p50Latency.toFixed(2)}ms`);
    console.log(`  P95: ${metrics.p95Latency.toFixed(2)}ms`);
    console.log(`  P99: ${metrics.p99Latency.toFixed(2)}ms`);
    console.log(`  Min: ${metrics.minLatency.toFixed(2)}ms`);
    console.log(`  Max: ${metrics.maxLatency.toFixed(2)}ms`);
    console.log(`\nThroughput: ${metrics.operationsPerSecond.toFixed(2)} ops/sec`);

    // Performance thresholds
    const thresholds = {
      p95Latency: 1000, // 1 second
      p99Latency: 2000, // 2 seconds
      successRate: 0.95, // 95%
    };

    console.log(`\n=== Performance Thresholds ===`);
    console.log(`P95 Latency: ${metrics.p95Latency <= thresholds.p95Latency ? '✅ PASS' : '❌ FAIL'} (${metrics.p95Latency.toFixed(2)}ms <= ${thresholds.p95Latency}ms)`);
    console.log(`P99 Latency: ${metrics.p99Latency <= thresholds.p99Latency ? '✅ PASS' : '❌ FAIL'} (${metrics.p99Latency.toFixed(2)}ms <= ${thresholds.p99Latency}ms)`);
    console.log(`Success Rate: ${(metrics.successfulOperations / metrics.totalOperations) >= thresholds.successRate ? '✅ PASS' : '❌ FAIL'} (${((metrics.successfulOperations / metrics.totalOperations) * 100).toFixed(2)}% >= ${(thresholds.successRate * 100).toFixed(2)}%)`);

    process.exit(0);
  } catch (error) {
    logger.error('Load test failed', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  } finally {
    await db.close();
  }
}

async function getOrCreateTestTenant(): Promise<string> {
  const result = await db.query<{ id: string }>(
    `SELECT id FROM tenants WHERE name = 'Load Test Tenant' LIMIT 1`
  );

  if (result.rows.length > 0) {
    return result.rows[0].id;
  }

  const newTenant = await db.query<{ id: string }>(
    `INSERT INTO tenants (id, name, is_active, created_at, updated_at)
     VALUES ($1, 'Load Test Tenant', true, NOW(), NOW())
     RETURNING id`,
    [randomUUID()]
  );

  return newTenant.rows[0].id;
}

if (require.main === module) {
  main();
}

export { runLoadTest, PerformanceMetrics };
