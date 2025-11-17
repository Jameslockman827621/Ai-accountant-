import cron from 'node-cron';
import { createLogger } from '@ai-accountant/shared-utils';
import { rulepackRegistryService } from '../../rules-engine/src/services/rulepackRegistry';
import { statuteMonitorService } from '../../rules-engine/src/services/statuteMonitor';

const logger = createLogger('rulepack-registry-scheduler');

export function startRegistryScheduler(): void {
  // Nightly regression at 02:00 UTC
  cron.schedule('0 2 * * *', async () => {
    try {
      logger.info('Starting nightly rulepack regression sweep');
      const rulepacks = await rulepackRegistryService.listRulepacks();
      const activeRulepacks = rulepacks.filter(pack => pack.isActive);

      for (const pack of activeRulepacks) {
        await rulepackRegistryService.runRegressionTests(pack.id, 'scheduled');
      }

      logger.info('Nightly regression sweep completed', { count: activeRulepacks.length });
    } catch (error) {
      logger.error(
        'Nightly regression sweep failed',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  });

  // Statute monitoring every 6 hours
  cron.schedule('30 */6 * * *', async () => {
    try {
      logger.info('Running statute monitoring scan');
      const results = await statuteMonitorService.scanAndRecord();
      logger.info('Statute monitoring completed', { resultCount: results.length });
    } catch (error) {
      logger.error(
        'Statute monitoring failed',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  });
}
