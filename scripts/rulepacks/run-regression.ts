#!/usr/bin/env ts-node

import { runRegressionSuite } from '../../services/rules-engine/src/services/multiCountryTax';
import { getBuiltInUSRulepacks } from '../../services/multi-jurisdiction/src/services/usTaxSystem';
import { getBuiltInEUTaxRulepacks } from '../../services/multi-jurisdiction/src/services/euTaxSystem';

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

  if (suitesWithFailures > 0) {
    process.exitCode = 1;
    console.error(
      `${suitesWithFailures} rulepack suite(s) reported failures. Inspect logs above.`,
    );
  } else {
    console.log('All built-in rulepacks passed regression.');
  }
}

void main();
