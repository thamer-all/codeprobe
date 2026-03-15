/**
 * `claude-test test [path]` — Run prompt tests against specs.
 *
 * Supports mock and live execution modes, watch mode, caching,
 * dataset evaluation, and JSON output.
 */

import { Command } from 'commander';
import { resolve } from 'node:path';
import { fileExists, isDirectory } from '../utils/fs.js';
import type { TestResult, ExecutionMode } from '../types/prompt.js';
import type { RunSummary } from '../types/results.js';
import { resolvePath } from '../utils/paths.js';
import { formatDuration } from '../utils/output.js';
import {
  runPromptTests,
  type RunOptions,
} from '../core/promptRunner.js';
import { runDatasetTests } from '../core/datasetRunner.js';
import { setLogLevel } from '../utils/logger.js';

export function registerTestCommand(program: Command): void {
  program
    .command('test [path]')
    .description('Run prompt tests against spec files')
    .option('-w, --watch', 'Watch mode — rerun tests on file changes')
    .option('-c, --cache', 'Enable result caching')
    .option('--json', 'Output results as JSON')
    .option('-v, --verbose', 'Show verbose output including assertion details')
    .option('--mode <mode>', 'Execution mode: mock or live', 'mock')
    .option('--model <model>', 'Override the model in the prompt spec (live mode)')
    .option('--dataset <path>', 'Run against a JSONL dataset file')
    .action(async (
      pathArg: string | undefined,
      options: {
        watch?: boolean;
        cache?: boolean;
        json?: boolean;
        verbose?: boolean;
        mode?: string;
        model?: string;
        dataset?: string;
      },
    ) => {
      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? 'prompts');
      const mode: ExecutionMode = options.mode === 'live' ? 'live' : 'mock';
      const runOpts: RunOptions = {
        mode,
        verbose: options.verbose,
        cache: options.cache,
        json: options.json,
        modelOverride: options.model,
      };

      async function runTests(): Promise<void> {
        // Suppress all logger output in JSON mode so only clean JSON is printed
        if (options.json) {
          setLogLevel('silent');
        }

        const startTime = Date.now();

        // Dataset mode
        if (options.dataset) {
          let specPath = targetPath;
          if (await isDirectory(targetPath)) {
            const { glob } = await import('glob');
            const files = await glob(
              resolve(targetPath, '**/*.prompt.{yaml,yml}'),
              { absolute: true },
            );
            if (files.length === 0) {
              throw new Error(`No prompt spec files found in ${targetPath}`);
            }
            specPath = files[0]!;
          }

          const dsResult = await runDatasetTests(
            specPath,
            resolvePath(options.dataset),
            runOpts,
          );

          if (options.json) {
            console.log(JSON.stringify(dsResult, null, 2));
            return;
          }

          console.log(chalk.bold(`\nDataset: ${dsResult.datasetPath}`));
          console.log(chalk.dim(`Prompt: ${dsResult.promptName}`));
          console.log(`Total rows: ${dsResult.totalRows}`);
          console.log(chalk.green(`Passed: ${dsResult.passed}`));
          if (dsResult.failed > 0) {
            console.log(chalk.red(`Failed: ${dsResult.failed}`));
            process.exitCode = 1;
          }
          return;
        }

        // Single file or directory — collect all TestResult[] uniformly
        let results: TestResult[];

        if (await fileExists(targetPath)) {
          results = await runPromptTests(targetPath, runOpts);
        } else if (await isDirectory(targetPath)) {
          // Discover spec files directly instead of delegating to regressionRunner
          const { glob } = await import('glob');
          let specFiles = await glob(
            resolve(targetPath, '**/*.prompt.{yaml,yml}'),
            { absolute: true },
          );
          if (specFiles.length === 0) {
            specFiles = await glob(
              resolve(targetPath, '**/*.{yaml,yml}'),
              { absolute: true },
            );
          }

          if (specFiles.length === 0) {
            if (options.json) {
              console.log(JSON.stringify({ tests: [], summary: { totalTests: 0, passed: 0, failed: 0, skipped: 0, duration: 0, cached: 0 } }, null, 2));
            } else {
              console.log(chalk.yellow('\nNo spec files found.'));
            }
            return;
          }

          results = [];
          for (const specFile of specFiles.sort()) {
            try {
              const fileResults = await runPromptTests(specFile, runOpts);
              results.push(...fileResults);
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              results.push({
                testName: specFile,
                promptName: specFile,
                passed: false,
                output: '',
                duration: 0,
                assertions: [],
                cached: false,
                error: `Failed to process spec file: ${errorMsg}`,
              });
            }
          }
        } else {
          throw new Error(`Path not found: ${targetPath}`);
        }

        if (results.length === 0) {
          if (options.json) {
            console.log(JSON.stringify({ tests: [], summary: { totalTests: 0, passed: 0, failed: 0, skipped: 0, duration: 0, cached: 0 } }, null, 2));
          } else {
            console.log(chalk.yellow('\nNo tests found.'));
          }
          return;
        }

        const summary: RunSummary = {
          totalTests: results.length,
          passed: results.filter((r) => r.passed).length,
          failed: results.filter((r) => !r.passed).length,
          skipped: 0,
          duration: Date.now() - startTime,
          cached: results.filter((r) => r.cached).length,
        };

        if (options.json) {
          console.log(JSON.stringify({ tests: results, summary }, null, 2));
          return;
        }

        console.log('');
        for (const result of results) {
          const icon = result.passed ? chalk.green('PASS') : chalk.red('FAIL');
          console.log(`  ${icon}  ${result.promptName} > ${result.testName} (${formatDuration(result.duration)})`);

          if (options.verbose && result.assertions.length > 0) {
            for (const assertion of result.assertions) {
              const aIcon = assertion.passed ? chalk.green('  +') : chalk.red('  -');
              console.log(`${aIcon} ${assertion.type}: expected=${assertion.expected}, got=${assertion.actual ?? 'N/A'}`);
            }
          }

          if (!result.passed && result.error) {
            console.log(chalk.red(`       Error: ${result.error}`));
          }
        }

        console.log('');
        console.log(
          chalk.bold('Summary: ') +
          chalk.green(`${summary.passed} passed`) + ', ' +
          (summary.failed > 0 ? chalk.red(`${summary.failed} failed`) : `${summary.failed} failed`) + ', ' +
          `${summary.totalTests} total` +
          chalk.dim(` (${formatDuration(summary.duration)})`),
        );

        if (summary.failed > 0) {
          process.exitCode = 1;
        }
      }

      await runTests();

      if (options.watch) {
        const chokidar = await import('chokidar');
        console.log(chalk.dim(`\nWatching for changes in ${targetPath}...`));

        const watcher = chokidar.watch(targetPath, {
          ignoreInitial: true,
          awaitWriteFinish: { stabilityThreshold: 300 },
        });

        watcher.on('change', async (changedPath: string) => {
          console.log(chalk.dim(`\nFile changed: ${changedPath}`));
          console.log(chalk.dim('Re-running tests...\n'));
          try {
            await runTests();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`Error: ${message}`));
          }
        });

        await new Promise<never>(() => {
          // Watch mode runs until interrupted
        });
      }
    });
}
