/**
 * `codeprobe score <prompt-file>` — Score prompt outputs on multiple criteria.
 *
 * Runs all tests in a prompt spec, scores each output on five criteria
 * (assertions, length, format, relevance, completeness), and reports
 * per-test and overall scores with A-F grades.
 */

import { Command } from 'commander';
import { resolve } from 'node:path';
import { resolvePath } from '../utils/paths.js';
import { fileExists, isDirectory } from '../utils/fs.js';
import { formatTable } from '../utils/output.js';
import {
  parsePromptSpec,
  runSingleTest,
  type RunOptions,
} from '../core/promptRunner.js';
import { scoreOutput } from '../core/scorer.js';
import type { ScoredTestResult } from '../types/results.js';
import type { ExecutionMode } from '../types/prompt.js';
import { setLogLevel } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerScoreCommand(program: Command): void {
  program
    .command('score <path>')
    .description('Score prompt outputs on multiple criteria (0-100 with A-F grades)')
    .option('--json', 'Output results as JSON')
    .option('-v, --verbose', 'Show per-criterion breakdown')
    .option('--mode <mode>', 'Execution mode: mock or live', 'mock')
    .option('--model <model>', 'Override the model in the prompt spec (live mode)')
    .action(async (
      pathArg: string,
      options: {
        json?: boolean;
        verbose?: boolean;
        mode?: string;
        model?: string;
      },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg);
      const mode: ExecutionMode = options.mode === 'live' ? 'live' : 'mock';

      const runOpts: RunOptions = {
        mode,
        verbose: options.verbose,
        cache: false,
        modelOverride: options.model,
      };

      // Collect prompt spec files
      let specFiles: string[];

      if (await fileExists(targetPath)) {
        specFiles = [targetPath];
      } else if (await isDirectory(targetPath)) {
        const { glob } = await import('glob');
        specFiles = await glob(
          resolve(targetPath, '**/*.prompt.{yaml,yml}'),
          { absolute: true },
        );
        if (specFiles.length === 0) {
          specFiles = await glob(
            resolve(targetPath, '**/*.{yaml,yml}'),
            { absolute: true },
          );
        }
        specFiles.sort();
      } else {
        console.error(chalk.red(`Error: path not found: ${targetPath}`));
        process.exitCode = 1;
        return;
      }

      if (specFiles.length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ prompts: [], overall: 0, grade: 'F' }, null, 2));
        } else {
          console.log(chalk.yellow('\nNo prompt spec files found.'));
        }
        return;
      }

      // Process each spec file
      const allScoredResults: ScoredTestResult[] = [];
      const promptSummaries: Array<{
        name: string;
        results: ScoredTestResult[];
        averageScore: number;
        grade: string;
      }> = [];

      for (const specFile of specFiles) {
        const spec = await parsePromptSpec(specFile);
        const tests = spec.tests ?? [];

        if (tests.length === 0) continue;

        const scoredResults: ScoredTestResult[] = [];

        for (const test of tests) {
          const result = await runSingleTest(spec, test, runOpts);
          const scoreResult = await scoreOutput(result.output, spec, test);

          const scored: ScoredTestResult = {
            testName: result.testName,
            promptName: result.promptName,
            passed: result.passed,
            score: scoreResult.overall,
            grade: scoreResult.grade,
            criteria: scoreResult.criteria.map((c) => ({
              name: c.name,
              score: c.score,
              weight: c.weight,
            })),
            output: result.output,
            duration: result.duration,
          };

          scoredResults.push(scored);
          allScoredResults.push(scored);
        }

        const avgScore = scoredResults.length > 0
          ? Math.round(scoredResults.reduce((sum, r) => sum + r.score, 0) / scoredResults.length)
          : 0;

        promptSummaries.push({
          name: spec.name,
          results: scoredResults,
          averageScore: avgScore,
          grade: gradeFromScore(avgScore),
        });
      }

      // Calculate overall
      const overallScore = allScoredResults.length > 0
        ? Math.round(allScoredResults.reduce((sum, r) => sum + r.score, 0) / allScoredResults.length)
        : 0;
      const overallGrade = gradeFromScore(overallScore);

      // JSON output
      if (options.json) {
        console.log(JSON.stringify({
          prompts: promptSummaries.map((ps) => ({
            name: ps.name,
            averageScore: ps.averageScore,
            grade: ps.grade,
            tests: ps.results,
          })),
          overall: overallScore,
          grade: overallGrade,
        }, null, 2));
        return;
      }

      // Table output
      for (const ps of promptSummaries) {
        console.log('');
        console.log(chalk.bold(`Prompt Score: ${ps.name}`));
        console.log('');

        const headers = ['Test', 'Score', 'Grade', 'Assertions', 'Format', 'Relevance'];
        const rows: string[][] = [];

        for (const r of ps.results) {
          const assertionCrit = r.criteria.find((c) => c.name === 'Assertions');
          const formatCrit = r.criteria.find((c) => c.name === 'Format');
          const relevanceCrit = r.criteria.find((c) => c.name === 'Relevance');

          rows.push([
            r.testName,
            String(r.score),
            r.grade,
            assertionCrit ? `${assertionCrit.score}%` : 'N/A',
            formatCrit ? `${formatCrit.score}%` : 'N/A',
            relevanceCrit ? `${relevanceCrit.score}%` : 'N/A',
          ]);
        }

        // Indent the table
        const table = formatTable(headers, rows);
        for (const line of table.split('\n')) {
          console.log(`  ${line}`);
        }

        // Verbose: per-criterion breakdown
        if (options.verbose) {
          console.log('');
          for (const r of ps.results) {
            console.log(chalk.dim(`  --- ${r.testName} ---`));
            for (const c of r.criteria) {
              const label = `${c.name}`.padEnd(14);
              const scoreStr = `${c.score}`.padStart(3);
              // Reconstruct details from the full score
              const fullSpec = await parsePromptSpec(specFiles.find((f) => f.includes(ps.name)) ?? specFiles[0]!);
              const fullTest = fullSpec.tests?.find((t) => t.name === r.testName);
              const fullScore = fullTest
                ? await scoreOutput(r.output, fullSpec, fullTest)
                : null;
              const fullCrit = fullScore?.criteria.find((fc) => fc.name === c.name);
              const details = fullCrit?.details ?? '';
              console.log(`    ${label} ${scoreStr}  ${chalk.dim(details)}`);
            }
          }
        }

        console.log('');
        const gradeColor = ps.averageScore >= 90 ? chalk.green
          : ps.averageScore >= 70 ? chalk.yellow
          : chalk.red;
        console.log(`  Overall: ${gradeColor(`${ps.averageScore} (${ps.grade})`)}`);
      }

      console.log('');
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gradeFromScore(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}
