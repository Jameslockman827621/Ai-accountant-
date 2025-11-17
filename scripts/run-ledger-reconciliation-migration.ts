#!/usr/bin/env ts-node
/**
 * Run ledger and reconciliation automation migration
 * Usage: ts-node scripts/run-ledger-reconciliation-migration.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '../services/database/src/index';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('migration-runner');

async function runMigration(): Promise<void> {
  try {
    logger.info('Starting ledger and reconciliation automation migration...');

    // Read migration file
    const migrationPath = join(
      __dirname,
      '..',
      'services',
      'database',
      'src',
      'migrations',
      'add_ledger_reconciliation_automation_schema.sql'
    );

    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    // Check if migration already applied
    const checkResult = await db.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'reconciliation_events'
      ) as exists`
    );

    if (checkResult.rows[0]?.exists) {
      logger.info('Migration appears to already be applied. Checking individual tables...');

      // Check a few key tables
      const tablesToCheck = [
        'reconciliation_events',
        'matching_thresholds',
        'period_close',
        'period_close_tasks',
        'entities',
        'intercompany_transactions',
        'exchange_rates',
        'fx_remeasurement_log',
        'reconciliation_exceptions',
        'consolidated_reports',
        'variance_alerts',
      ];

      const missingTables: string[] = [];
      for (const table of tablesToCheck) {
        const tableCheck = await db.query<{ exists: boolean }>(
          `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          ) as exists`,
          [table]
        );

        if (!tableCheck.rows[0]?.exists) {
          missingTables.push(table);
        }
      }

      if (missingTables.length === 0) {
        logger.info('All tables exist. Migration already applied.');
        return;
      } else {
        logger.info(`Found ${missingTables.length} missing tables. Applying migration...`);
      }
    }

    // Execute migration
    logger.info('Executing migration SQL...');
    await db.query(migrationSQL);

    logger.info('Migration completed successfully!');

    // Verify tables were created
    const verifyResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'reconciliation_events', 'matching_thresholds', 'period_close',
           'period_close_tasks', 'entities', 'intercompany_transactions',
           'exchange_rates', 'fx_remeasurement_log', 'reconciliation_exceptions',
           'consolidated_reports', 'variance_alerts'
         )`
    );

    const tableCount = parseInt(verifyResult.rows[0]?.count || '0', 10);
    logger.info(`Verified ${tableCount} tables created`);

    if (tableCount < 11) {
      logger.warn(`Expected 11 tables, found ${tableCount}. Some tables may be missing.`);
    }
  } catch (error) {
    logger.error('Migration failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  runMigration()
    .then(() => {
      logger.info('Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Migration script failed', error);
      process.exit(1);
    });
}

export { runMigration };
