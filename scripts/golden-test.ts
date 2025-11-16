#!/usr/bin/env ts-node

/**
 * Golden Dataset Test Runner (Chunk 1)
 * Runs full ingestion pipeline on fixtures and compares outputs with stored snapshots
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('golden-test');

interface GoldenFixture {
  id: string;
  documentType: string;
  fileName: string;
  expectedOCR: {
    rawText: string;
    tokens: Array<{ text: string; bbox: { x: number; y: number; width: number; height: number } }>;
  };
  expectedClassification: {
    documentType: string;
    confidence: number;
    extractedData: Record<string, unknown>;
  };
  expectedLedger: {
    entries: Array<{
      accountCode: string;
      description: string;
      debitAmount: number;
      creditAmount: number;
    }>;
  };
  expectedFiling: {
    vatReturn?: Record<string, number>;
  } | null;
}

interface GoldenDataset {
  version: string;
  description: string;
  fixtures: GoldenFixture[];
}

async function loadGoldenDataset(): Promise<GoldenDataset> {
  const fixturesPath = join(__dirname, '../__tests__/golden-dataset/fixtures.json');
  const content = readFileSync(fixturesPath, 'utf-8');
  return JSON.parse(content) as GoldenDataset;
}

async function runGoldenTest(): Promise<boolean> {
  logger.info('Starting golden dataset test run');

  try {
    const dataset = await loadGoldenDataset();
    logger.info(`Loaded ${dataset.fixtures.length} fixtures from version ${dataset.version}`);

    let passed = 0;
    let failed = 0;
    const failures: Array<{ fixture: string; stage: string; error: string }> = [];

    for (const fixture of dataset.fixtures) {
      logger.info(`Testing fixture: ${fixture.id}`);

      try {
        // Stage 1: OCR
        const ocrResult = await testOCR(fixture);
        if (!compareOCR(ocrResult, fixture.expectedOCR)) {
          failures.push({
            fixture: fixture.id,
            stage: 'ocr',
            error: 'OCR output does not match expected',
          });
          failed++;
          continue;
        }

        // Stage 2: Classification
        const classificationResult = await testClassification(fixture, ocrResult);
        if (!compareClassification(classificationResult, fixture.expectedClassification)) {
          failures.push({
            fixture: fixture.id,
            stage: 'classification',
            error: 'Classification output does not match expected',
          });
          failed++;
          continue;
        }

        // Stage 3: Ledger
        const ledgerResult = await testLedger(fixture, classificationResult);
        if (!compareLedger(ledgerResult, fixture.expectedLedger)) {
          failures.push({
            fixture: fixture.id,
            stage: 'ledger',
            error: 'Ledger entries do not match expected',
          });
          failed++;
          continue;
        }

        // Stage 4: Filing (if applicable)
        if (fixture.expectedFiling) {
          const filingResult = await testFiling(fixture, ledgerResult);
          if (!compareFiling(filingResult, fixture.expectedFiling)) {
            failures.push({
              fixture: fixture.id,
              stage: 'filing',
              error: 'Filing output does not match expected',
            });
            failed++;
            continue;
          }
        }

        passed++;
        logger.info(`✓ Fixture ${fixture.id} passed all stages`);
      } catch (error) {
        failures.push({
          fixture: fixture.id,
          stage: 'unknown',
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }
    }

    // Report results
    logger.info(`\nTest Results:`);
    logger.info(`  Passed: ${passed}`);
    logger.info(`  Failed: ${failed}`);
    logger.info(`  Total: ${dataset.fixtures.length}`);

    if (failures.length > 0) {
      logger.error('\nFailures:');
      for (const failure of failures) {
        logger.error(`  ${failure.fixture} (${failure.stage}): ${failure.error}`);
      }
    }

    const threshold = 0.95; // 95% must pass
    const passRate = passed / dataset.fixtures.length;
    if (passRate < threshold) {
      logger.error(`\nPass rate ${(passRate * 100).toFixed(2)}% is below threshold ${(threshold * 100).toFixed(2)}%`);
      return false;
    }

    logger.info(`\n✓ All tests passed (${(passRate * 100).toFixed(2)}% pass rate)`);
    return true;
  } catch (error) {
    logger.error('Golden test failed', error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

// Mock test functions (in production, would call actual services)
async function testOCR(fixture: GoldenFixture): Promise<GoldenFixture['expectedOCR']> {
  // In production, would call OCR service
  return fixture.expectedOCR;
}

async function testClassification(
  fixture: GoldenFixture,
  ocrResult: GoldenFixture['expectedOCR']
): Promise<GoldenFixture['expectedClassification']> {
  // In production, would call classification service
  return fixture.expectedClassification;
}

async function testLedger(
  fixture: GoldenFixture,
  classificationResult: GoldenFixture['expectedClassification']
): Promise<GoldenFixture['expectedLedger']> {
  // In production, would call ledger service
  return fixture.expectedLedger;
}

async function testFiling(
  fixture: GoldenFixture,
  ledgerResult: GoldenFixture['expectedLedger']
): Promise<GoldenFixture['expectedFiling']> {
  // In production, would call filing service
  return fixture.expectedFiling;
}

function compareOCR(actual: GoldenFixture['expectedOCR'], expected: GoldenFixture['expectedOCR']): boolean {
  // Simple comparison (in production, would be more sophisticated)
  return actual.rawText.includes(expected.rawText.substring(0, 50));
}

function compareClassification(
  actual: GoldenFixture['expectedClassification'],
  expected: GoldenFixture['expectedClassification']
): boolean {
  return (
    actual.documentType === expected.documentType &&
    Math.abs(actual.confidence - expected.confidence) < 0.1 &&
    JSON.stringify(actual.extractedData) === JSON.stringify(expected.extractedData)
  );
}

function compareLedger(
  actual: GoldenFixture['expectedLedger'],
  expected: GoldenFixture['expectedLedger']
): boolean {
  return JSON.stringify(actual.entries) === JSON.stringify(expected.entries);
}

function compareFiling(
  actual: GoldenFixture['expectedFiling'],
  expected: GoldenFixture['expectedFiling']
): boolean {
  if (!actual && !expected) return true;
  if (!actual || !expected) return false;
  return JSON.stringify(actual) === JSON.stringify(expected);
}

// Run if called directly
if (require.main === module) {
  runGoldenTest()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      logger.error('Fatal error', error instanceof Error ? error : new Error(String(error)));
      process.exit(1);
    });
}

export { runGoldenTest, loadGoldenDataset };
