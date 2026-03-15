/**
 * Dataset test runner — runs a prompt spec against each row in a JSONL dataset.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  DatasetRow,
  DatasetResult,
  DatasetRowResult,
} from '../types/dataset.js';
import type { TestExpectation, AssertionResult } from '../types/prompt.js';
import { parsePromptSpec, runSingleTest, evaluateAssertions } from './promptRunner.js';
import type { RunOptions } from './promptRunner.js';
import { logger } from '../utils/logger.js';

/**
 * Parse a JSONL file into an array of DatasetRow objects.
 */
function parseJsonl(content: string): DatasetRow[] {
  const rows: DatasetRow[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null) {
        logger.warn(`JSONL line ${i + 1}: expected an object, got ${typeof parsed}`);
        continue;
      }

      const obj = parsed as Record<string, unknown>;
      if (typeof obj.input !== 'string') {
        logger.warn(`JSONL line ${i + 1}: missing or non-string "input" field`);
        continue;
      }

      const row: DatasetRow = {
        input: obj.input,
      };

      if (typeof obj.expected === 'string') {
        row.expected = obj.expected;
      }

      if (typeof obj.metadata === 'object' && obj.metadata !== null) {
        row.metadata = obj.metadata as Record<string, unknown>;
      }

      rows.push(row);
    } catch {
      logger.warn(`JSONL line ${i + 1}: invalid JSON, skipping`);
    }
  }

  return rows;
}

/**
 * Build a TestExpectation from a dataset row's expected field.
 * If the row has an expected string, create a "contains" assertion for it.
 */
function buildExpectationFromRow(row: DatasetRow): TestExpectation | undefined {
  if (!row.expected) {
    return undefined;
  }
  return {
    contains: [row.expected],
  };
}

/**
 * Run a prompt spec against each row of a JSONL dataset file.
 */
export async function runDatasetTests(
  specPath: string,
  datasetPath: string,
  options: RunOptions,
): Promise<DatasetResult> {
  const absoluteSpecPath = resolve(specPath);
  const absoluteDatasetPath = resolve(datasetPath);

  // Parse the prompt spec
  const spec = await parsePromptSpec(absoluteSpecPath);

  // Read and parse the JSONL dataset
  const datasetContent = await readFile(absoluteDatasetPath, 'utf-8');
  const rows = parseJsonl(datasetContent);

  if (rows.length === 0) {
    logger.warn(`No valid rows found in dataset "${absoluteDatasetPath}"`);
    return {
      datasetPath: absoluteDatasetPath,
      promptName: spec.name,
      totalRows: 0,
      passed: 0,
      failed: 0,
      results: [],
    };
  }

  logger.info(`Running "${spec.name}" against ${rows.length} dataset row(s)...`);

  const results: DatasetRowResult[] = [];
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Build a test with the row's input
    const testCase = {
      name: `dataset-row-${i}`,
      input: row.input,
      expect: buildExpectationFromRow(row),
    };

    // Run the test
    const testResult = await runSingleTest(spec, testCase, options);

    // If the dataset row has its own expected field, evaluate those assertions
    let assertions: AssertionResult[] = testResult.assertions;
    if (row.expected && testCase.expect) {
      assertions = await evaluateAssertions(testResult.output, testCase.expect);
    }

    const rowPassed =
      assertions.length === 0 || assertions.every((a) => a.passed);

    if (rowPassed) {
      passed++;
    } else {
      failed++;
    }

    results.push({
      rowIndex: i,
      input: row.input,
      expected: row.expected,
      output: testResult.output,
      passed: rowPassed,
      assertions,
    });

    if (options.verbose) {
      const status = rowPassed ? 'PASS' : 'FAIL';
      logger.info(`  Row ${i}: ${status}`);
    }
  }

  logger.info(
    `Dataset run complete: ${passed}/${rows.length} passed, ${failed} failed`,
  );

  return {
    datasetPath: absoluteDatasetPath,
    promptName: spec.name,
    totalRows: rows.length,
    passed,
    failed,
    results,
  };
}
