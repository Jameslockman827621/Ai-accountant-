#!/usr/bin/env ts-node

import { runRegressionSuite } from '../../services/rules-engine/src/services/multiCountryTax';
import { getBuiltInUSRulepacks } from '../../services/multi-jurisdiction/src/services/usTaxSystem';
import { getBuiltInEUTaxRulepacks } from '../../services/multi-jurisdiction/src/services/euTaxSystem';
import { rulepackRegistryService } from '../../services/rules-engine/src/services/rulepackRegistry';

async function main(): Promise<void> {
  const rulepacks = [...getBuiltInUSRulepacks(), ...getBuiltInEUTaxRulepacks()];
  let suitesWithFailures = 0;

  for (const pack of rulepacks) {
    const { summary } = await runRegressionSuite(pack);
    const label = `${pack.jurisdictionCode} v${pack.version}`;
    if (summary.failed > 0) {
      suitesWithFailures += 1;
      console.error(
        `❌ ${label} regression failed (${summary.failed} of ${summary.total} cases)`,
      );
    } else {
      console.log(
        `✅ ${label} regression passed (${summary.passed}/${summary.total})`,
      );
    }
  }

  const dbRulepacks = (await rulepackRegistryService.listRulepacks()).filter(pack => pack.isActive);
  for (const pack of dbRulepacks) {
    try {
      const run = await rulepackRegistryService.runRegressionTestsBlocking(pack.id, 'scheduled');
      const passRate = run.totalTests === 0 ? 1 : run.passedTests / run.totalTests;
      if (run.status !== 'passed' || passRate < 0.99) {
        suitesWithFailures += 1;
        console.error(
          `❌ ${pack.jurisdiction} ${pack.version} regression blocked (${run.passedTests}/${run.totalTests} cases)`,
        );
      } else {
        console.log(
          `✅ ${pack.jurisdiction} ${pack.version} regression passed (${run.passedTests}/${run.totalTests})`,
        );
      }
    } catch (error) {
      suitesWithFailures += 1;
      console.error(`❌ ${pack.jurisdiction} ${pack.version} regression errored`, error);
    }
  }

  if (suitesWithFailures > 0) {
    process.exitCode = 1;
    console.error(
      `${suitesWithFailures} rulepack suite(s) reported failures. Inspect logs above.`,
    );
  } else {
    console.log('All built-in and active rulepacks passed regression.');
  }
}

void main();
