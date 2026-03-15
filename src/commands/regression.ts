/**
 * `claude-test regression [path]` — Run tests and compare against a saved baseline.
 *
 * First run with `--save` to establish a baseline of passing tests.
 * Subsequent runs compare current results against that baseline and
 * report any regressions (tests that previously passed but now fail).
 */

import { Command } from 'commander';
import { resolve, dirname } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolvePath } from '../utils/paths.js';
import { isDirectory, fileExists } from '../utils/fs.js';
import { runRegressionTests } from '../core/regressionRunner.js';
import type { RunOptions } from '../core/promptRunner.js';
import type { RunSummary } from '../types/results.js';
import { formatDuration } from '../utils/output.js';
import { setLogLevel } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Baseline types
// ---------------------------------------------------------------------------

interface BaselineEntry {
  testName: string;
  passed: boolean;
}

interface BaselineFile {
  savedAt: string;
  path: string;
  summary: RunSummary;
  tests: BaselineEntry[];
}

interface RegressionReport {
  totalTests: number;
  passed: number;
  failed: number;
  regressions: string[];
  newPasses: string[];
  duration: number;
  baselinePath: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_BASELINE_PATH = resolve(process.cwd(), '.cache', 'regression-baseline.json');

async function loadBaseline(baselinePath: string): Promise<BaselineFile | null> {
  try {
    const raw = await readFile(baselinePath, 'utf-8');
    return JSON.parse(raw) as BaselineFile;
  } catch {
    return null;
  }
}

async function saveBaseline(baselinePath: string, baseline: BaselineFile): Promise<void> {
  const dir = dirname(baselinePath);
  await mkdir(dir, { recursive: true });
  await writeFile(baselinePath, JSON.stringify(baseline, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerRegressionCommand(program: Command): void {
  program
    .command('regression [path]')
    .description('Run tests and compare against a saved baseline to detect regressions')
    .option('--save', 'Save current results as the new baseline')
    .option('--json', 'Output results as JSON')
    .option('--baseline <file>', 'Custom baseline file path')
    .option('--mode <mode>', 'Execution mode: mock or live', 'mock')
    .option('-v, --verbose', 'Show verbose output')
    .action(async (
      pathArg: string | undefined,
      options: {
        save?: boolean;
        json?: boolean;
        baseline?: string;
        mode?: string;
        verbose?: boolean;
      },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? 'prompts');
      const baselinePath = options.baseline
        ? resolvePath(options.baseline)
        : DEFAULT_BASELINE_PATH;

      // Verify target is a directory
      if (!(await isDirectory(targetPath))) {
        if (!(await fileExists(targetPath))) {
          console.error(chalk.red(`Error: path not found: ${targetPath}`));
          process.exitCode = 1;
          return;
        }
      }

      const runOpts: RunOptions = {
        mode: options.mode === 'live' ? 'live' : 'mock',
        verbose: options.verbose,
      };

      // Run the tests
      const startTime = Date.now();
      const summary = await runRegressionTests(targetPath, runOpts);
      const duration = Date.now() - startTime;

      // Build a flat list of test entries from the summary.
      // The regressionRunner returns aggregate counts, not individual results.
      // We record the aggregate as a single entry for baseline comparison.
      const testEntries: BaselineEntry[] = [
        { testName: '__aggregate__', passed: summary.failed === 0 },
      ];

      // --save mode: persist baseline
      if (options.save) {
        const baseline: BaselineFile = {
          savedAt: new Date().toISOString(),
          path: targetPath,
          summary,
          tests: testEntries,
        };
        await saveBaseline(baselinePath, baseline);

        if (options.json) {
          console.log(JSON.stringify({
            action: 'saved',
            baselinePath,
            summary,
          }, null, 2));
          return;
        }

        console.log('');
        console.log(chalk.bold('Regression Baseline Saved'));
        console.log(chalk.dim(`  File: ${baselinePath}`));
        console.log(`  Total tests:  ${summary.totalTests}`);
        console.log(chalk.green(`  Passed:       ${summary.passed}`));
        if (summary.failed > 0) {
          console.log(chalk.red(`  Failed:       ${summary.failed}`));
        } else {
          console.log(`  Failed:       ${summary.failed}`);
        }
        console.log(`  Skipped:      ${summary.skipped}`);
        console.log(chalk.dim(`  Duration:     ${formatDuration(duration)}`));
        console.log('');
        return;
      }

      // Compare mode: load baseline and compare
      const existingBaseline = await loadBaseline(baselinePath);

      if (!existingBaseline) {
        // No baseline — just report results with a warning
        if (options.json) {
          console.log(JSON.stringify({
            warning: 'No baseline found. Run with --save first.',
            summary,
          }, null, 2));
          return;
        }

        console.log('');
        console.log(chalk.yellow('Warning: No baseline found. Run with --save first.'));
        console.log('');
        console.log(chalk.bold('Current Results'));
        console.log(`  Total tests:  ${summary.totalTests}`);
        console.log(chalk.green(`  Passed:       ${summary.passed}`));
        if (summary.failed > 0) {
          console.log(chalk.red(`  Failed:       ${summary.failed}`));
        } else {
          console.log(`  Failed:       ${summary.failed}`);
        }
        console.log(`  Skipped:      ${summary.skipped}`);
        console.log(chalk.dim(`  Duration:     ${formatDuration(duration)}`));
        console.log('');
        if (summary.failed > 0) {
          process.exitCode = 1;
        }
        return;
      }

      // Compare: find regressions and new passes
      const regressions: string[] = [];
      const newPasses: string[] = [];

      // Compare aggregate counts
      if (existingBaseline.summary.passed > summary.passed) {
        const diff = existingBaseline.summary.passed - summary.passed;
        regressions.push(`${diff} test(s) that previously passed now fail`);
      }
      if (summary.passed > existingBaseline.summary.passed) {
        const diff = summary.passed - existingBaseline.summary.passed;
        newPasses.push(`${diff} new test(s) now pass`);
      }
      if (summary.failed > existingBaseline.summary.failed) {
        const diff = summary.failed - existingBaseline.summary.failed;
        if (regressions.length === 0) {
          regressions.push(`${diff} more test(s) failing compared to baseline`);
        }
      }

      const report: RegressionReport = {
        totalTests: summary.totalTests,
        passed: summary.passed,
        failed: summary.failed,
        regressions,
        newPasses,
        duration,
        baselinePath,
      };

      if (options.json) {
        console.log(JSON.stringify({
          report,
          baseline: {
            savedAt: existingBaseline.savedAt,
            summary: existingBaseline.summary,
          },
          current: { summary },
        }, null, 2));
        return;
      }

      console.log('');
      console.log(chalk.bold('Regression Report'));
      console.log(chalk.dim(`  Baseline: ${baselinePath}`));
      console.log(chalk.dim(`  Saved at: ${existingBaseline.savedAt}`));
      console.log('');

      // Baseline vs Current
      console.log('  Baseline  =>  Current');
      console.log(`  ${existingBaseline.summary.passed} passed   =>  ${summary.passed} passed`);
      console.log(`  ${existingBaseline.summary.failed} failed   =>  ${summary.failed} failed`);
      console.log(`  ${existingBaseline.summary.totalTests} total    =>  ${summary.totalTests} total`);
      console.log('');

      if (regressions.length > 0) {
        console.log(chalk.red.bold('  REGRESSIONS DETECTED:'));
        for (const r of regressions) {
          console.log(chalk.red(`    - ${r}`));
        }
        console.log('');
        process.exitCode = 1;
      }

      if (newPasses.length > 0) {
        console.log(chalk.green('  Improvements:'));
        for (const p of newPasses) {
          console.log(chalk.green(`    + ${p}`));
        }
        console.log('');
      }

      if (regressions.length === 0 && newPasses.length === 0) {
        console.log(chalk.green('  No regressions detected. Results match baseline.'));
        console.log('');
      }

      console.log(chalk.dim(`  Duration: ${formatDuration(duration)}`));
      console.log('');
    });
}
