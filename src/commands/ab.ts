/**
 * `codeprobe ab <prompt-a> <prompt-b>` — A/B test two prompt specs against the
 * same test inputs and compare results side by side.
 */

import { Command } from 'commander';
import { parsePromptSpec, runSingleTest, evaluateAssertions } from '../core/promptRunner.js';
import { resolvePath } from '../utils/paths.js';
import { formatTable } from '../utils/output.js';
import { setLogLevel } from '../utils/logger.js';
import type { RunOptions } from '../core/promptRunner.js';
import type { PromptSpec, PromptTest, AssertionResult } from '../types/prompt.js';
import { scoreOutput as canonicalScoreOutput } from '../core/scorer.js';

// ---------------------------------------------------------------------------
// Scorer — wraps the canonical scorer to produce a numeric score
// ---------------------------------------------------------------------------

async function scoreOutput(output: string, spec: PromptSpec, test: PromptTest): Promise<number> {
  const result = await canonicalScoreOutput(output, spec, test);
  return result.overall;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AbTestRow {
  testName: string;
  scoreA: number;
  scoreB: number;
  winner: 'A' | 'B' | 'tie';
  delta: number;
  assertionsA: AssertionResult[];
  assertionsB: AssertionResult[];
  outputA: string;
  outputB: string;
}

interface AbResult {
  promptA: string;
  promptB: string;
  tests: AbTestRow[];
  winsA: number;
  winsB: number;
  ties: number;
  avgA: number;
  avgB: number;
  recommendation: string;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

async function runAbTest(
  specA: PromptSpec,
  specB: PromptSpec,
  runs: number,
  options: RunOptions,
): Promise<AbResult> {
  // Use tests from A, falling back to B's tests if A has none
  const tests: PromptTest[] = (specA.tests && specA.tests.length > 0)
    ? specA.tests
    : (specB.tests ?? []);

  if (tests.length === 0) {
    throw new Error(
      'Neither prompt spec defines tests. At least one spec must include a "tests" section.',
    );
  }

  const rows: AbTestRow[] = [];

  for (const test of tests) {
    let totalScoreA = 0;
    let totalScoreB = 0;
    let lastAssertionsA: AssertionResult[] = [];
    let lastAssertionsB: AssertionResult[] = [];
    let lastOutputA = '';
    let lastOutputB = '';

    for (let run = 0; run < runs; run++) {
      // Run with prompt A
      const resultA = await runSingleTest(specA, test, options);
      const expectA = test.expect;
      const assertionsA = expectA
        ? await evaluateAssertions(resultA.output, expectA)
        : [];
      totalScoreA += await scoreOutput(resultA.output, specA, test);
      lastAssertionsA = assertionsA;
      lastOutputA = resultA.output;

      // Run with prompt B
      const resultB = await runSingleTest(specB, test, options);
      const expectB = test.expect;
      const assertionsB = expectB
        ? await evaluateAssertions(resultB.output, expectB)
        : [];
      totalScoreB += await scoreOutput(resultB.output, specB, test);
      lastAssertionsB = assertionsB;
      lastOutputB = resultB.output;
    }

    const avgScoreA = Math.round(totalScoreA / runs);
    const avgScoreB = Math.round(totalScoreB / runs);
    const delta = avgScoreB - avgScoreA;
    const winner: 'A' | 'B' | 'tie' =
      delta > 0 ? 'B' : delta < 0 ? 'A' : 'tie';

    rows.push({
      testName: test.name,
      scoreA: avgScoreA,
      scoreB: avgScoreB,
      winner,
      delta,
      assertionsA: lastAssertionsA,
      assertionsB: lastAssertionsB,
      outputA: lastOutputA,
      outputB: lastOutputB,
    });
  }

  const winsA = rows.filter((r) => r.winner === 'A').length;
  const winsB = rows.filter((r) => r.winner === 'B').length;
  const ties = rows.filter((r) => r.winner === 'tie').length;
  const avgA = rows.length > 0
    ? rows.reduce((sum, r) => sum + r.scoreA, 0) / rows.length
    : 0;
  const avgB = rows.length > 0
    ? rows.reduce((sum, r) => sum + r.scoreB, 0) / rows.length
    : 0;

  const avgDiff = avgB - avgA;
  let recommendation: string;
  if (Math.abs(avgDiff) < 0.5) {
    recommendation = 'Results are effectively tied — no clear winner';
  } else if (avgDiff > 0) {
    recommendation = `Prompt B scores higher on average (+${avgDiff.toFixed(1)})`;
  } else {
    recommendation = `Prompt A scores higher on average (+${Math.abs(avgDiff).toFixed(1)})`;
  }

  return {
    promptA: specA.name,
    promptB: specB.name,
    tests: rows,
    winsA,
    winsB,
    ties,
    avgA,
    avgB,
    recommendation,
  };
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerAbCommand(program: Command): void {
  program
    .command('ab <prompt-a> <prompt-b>')
    .description('A/B test two prompt specs — compare scores side by side')
    .option('--json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed per-test comparison')
    .option('--runs <n>', 'Runs per test', '1')
    .option('--mode <mode>', 'Execution mode: mock or live', 'mock')
    .action(async (
      pathA: string,
      pathB: string,
      options: {
        json?: boolean;
        verbose?: boolean;
        runs: string;
        mode?: string;
      },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;

      const resolvedA = resolvePath(pathA);
      const resolvedB = resolvePath(pathB);
      const runs = Math.max(1, parseInt(options.runs, 10) || 1);

      const runOpts: RunOptions = {
        mode: options.mode === 'live' ? 'live' : 'mock',
        verbose: options.verbose,
      };

      // Parse both specs
      let specA: PromptSpec;
      let specB: PromptSpec;
      try {
        specA = await parsePromptSpec(resolvedA);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error parsing prompt A: ${msg}`));
        process.exitCode = 1;
        return;
      }
      try {
        specB = await parsePromptSpec(resolvedB);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error parsing prompt B: ${msg}`));
        process.exitCode = 1;
        return;
      }

      // Run the A/B comparison
      const result = await runAbTest(specA, specB, runs, runOpts);

      // JSON output
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      // Pretty output
      console.log('');
      console.log(chalk.bold('A/B Comparison'));
      console.log('');
      console.log(`  Prompt A: ${chalk.cyan(result.promptA)}`);
      console.log(`  Prompt B: ${chalk.cyan(result.promptB)}`);
      if (runs > 1) {
        console.log(chalk.dim(`  Runs per test: ${runs}`));
      }
      console.log('');

      // Build comparison table
      const tableRows = result.tests.map((row) => {
        const winnerLabel = row.winner === 'tie'
          ? chalk.dim('tie')
          : row.winner === 'A'
            ? chalk.green('A')
            : chalk.green('B');
        const deltaStr = row.delta === 0
          ? chalk.dim('0')
          : row.delta > 0
            ? chalk.green(`+${row.delta}`)
            : chalk.red(`${row.delta}`);

        return [
          row.testName,
          String(row.scoreA),
          String(row.scoreB),
          winnerLabel,
          deltaStr,
        ];
      });

      const table = formatTable(
        ['Test', 'A Score', 'B Score', 'Winner', 'Delta'],
        tableRows,
      );

      for (const line of table.split('\n')) {
        console.log(`  ${line}`);
      }

      // Verbose: per-test details
      if (options.verbose) {
        console.log('');
        console.log(chalk.bold('  Per-Test Details'));
        for (const row of result.tests) {
          console.log('');
          console.log(chalk.bold(`  ${row.testName}`));
          console.log(chalk.dim(`    Output A (${row.outputA.length} chars):`));
          console.log(`      ${row.outputA.slice(0, 200).replace(/\n/g, '\n      ')}`);
          console.log(chalk.dim(`    Output B (${row.outputB.length} chars):`));
          console.log(`      ${row.outputB.slice(0, 200).replace(/\n/g, '\n      ')}`);

          if (row.assertionsA.length > 0) {
            console.log(chalk.dim('    Assertions A:'));
            for (const a of row.assertionsA) {
              const icon = a.passed ? chalk.green('PASS') : chalk.red('FAIL');
              console.log(`      ${icon} [${a.type}] expected: ${a.expected}`);
            }
          }
          if (row.assertionsB.length > 0) {
            console.log(chalk.dim('    Assertions B:'));
            for (const a of row.assertionsB) {
              const icon = a.passed ? chalk.green('PASS') : chalk.red('FAIL');
              console.log(`      ${icon} [${a.type}] expected: ${a.expected}`);
            }
          }
        }
      }

      // Summary
      console.log('');
      console.log(chalk.bold('  Summary:'));
      console.log(`    Prompt A wins: ${result.winsA} test${result.winsA !== 1 ? 's' : ''}`);
      console.log(`    Prompt B wins: ${result.winsB} test${result.winsB !== 1 ? 's' : ''}`);
      if (result.ties > 0) {
        console.log(`    Ties:          ${result.ties} test${result.ties !== 1 ? 's' : ''}`);
      }
      console.log(`    Average A: ${result.avgA.toFixed(1)}    Average B: ${result.avgB.toFixed(1)}`);
      console.log('');
      console.log(`  Recommendation: ${result.recommendation}`);
      console.log('');
    });
}
