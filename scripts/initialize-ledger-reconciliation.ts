#!/usr/bin/env ts-node
/**
 * Initialize ledger and reconciliation automation system
 * - Run database migration
 * - Initialize matching thresholds for all tenants
 * - Set up default exchange rates
 * Usage: ts-node scripts/initialize-ledger-reconciliation.ts
 */

import { db } from '../services/database/src/index';
import { matchingThresholdsInitializer } from '../services/reconciliation/src/services/matchingThresholdsInitializer';
import { exchangeRateService } from '../services/ledger/src/services/exchangeRateService';
import { createLogger } from '@ai-accountant/shared-utils';
import { runMigration } from './run-ledger-reconciliation-migration';

const logger = createLogger('initialize-ledger-reconciliation');

async function initializeSystem(): Promise<void> {
  try {
    logger.info('Starting ledger and reconciliation automation initialization...');

    // Step 1: Run database migration
    logger.info('Step 1: Running database migration...');
    await runMigration();
    logger.info('✓ Database migration completed');

    // Step 2: Initialize matching thresholds for all tenants
    logger.info('Step 2: Initializing matching thresholds for all tenants...');
    const thresholdResult = await matchingThresholdsInitializer.initializeForAllTenants();
    logger.info('✓ Matching thresholds initialized', thresholdResult);

    // Step 3: Set up default exchange rates (for common currencies)
    logger.info('Step 3: Setting up default exchange rates...');
    const commonCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY'];
    const baseCurrency = 'GBP';
    const today = new Date();
    const lastMonth = new Date(today);
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    // Get all active tenants
    const tenantsResult = await db.query<{ id: string }>(
      `SELECT id FROM tenants WHERE is_active = true`
    );

    let totalRatesSynced = 0;
    let totalRatesFailed = 0;

    for (const tenant of tenantsResult.rows) {
      try {
        const result = await exchangeRateService.syncExchangeRates(
          tenant.id,
          baseCurrency,
          commonCurrencies.filter((c) => c !== baseCurrency),
          lastMonth,
          today,
          { provider: 'ECB' }
        );
        totalRatesSynced += result.synced;
        totalRatesFailed += result.failed;
      } catch (error) {
        logger.error('Failed to sync exchange rates for tenant', {
          tenantId: tenant.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    logger.info('✓ Exchange rates synced', {
      totalRatesSynced,
      totalRatesFailed,
      tenants: tenantsResult.rows.length,
    });

    logger.info('✓ Initialization completed successfully!');

    // Print summary
    console.log('\n=== Initialization Summary ===');
    console.log(`✓ Database migration: Completed`);
    console.log(`✓ Matching thresholds: ${thresholdResult.initialized} initialized, ${thresholdResult.skipped} skipped`);
    console.log(`✓ Exchange rates: ${totalRatesSynced} synced, ${totalRatesFailed} failed`);
    console.log(`✓ Tenants processed: ${tenantsResult.rows.length}`);
  } catch (error) {
    logger.error('Initialization failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  initializeSystem()
    .then(() => {
      logger.info('Initialization script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Initialization script failed', error);
      process.exit(1);
    });
}

export { initializeSystem };
