/**
 * `codeprobe quality [path]` — Score the context quality of a repository.
 *
 * Evaluates signal-to-noise ratio, file diversity, documentation coverage,
 * redundancy, context window utilization, and AI tool readiness. All scoring
 * is offline (no API calls required).
 */

import { Command } from 'commander';
import { stat } from 'node:fs/promises';
import { resolvePath } from '../utils/paths.js';
import { setLogLevel } from '../utils/logger.js';
import { scoreContextQuality } from '../core/contextQuality.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render an ASCII bar for a percentage score.
 */
function renderBar(score: number, width: number = 20): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerQualityCommand(program: Command): void {
  program
    .command('quality [path]')
    .description('Score context quality — signal-to-noise, diversity, docs, redundancy, AI readiness')
    .option('--json', 'Output as JSON')
    .action(async (
      pathArg: string | undefined,
      options: { json?: boolean },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? '.');

      try {
        await stat(targetPath);
      } catch {
        console.error(chalk.red(`Error: path not found: ${targetPath}`));
        process.exitCode = 1;
        return;
      }

      const report = await scoreContextQuality(targetPath);

      // JSON output
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      // Pretty output
      console.log('');
      console.log(chalk.bold('Context Quality Score'));
      console.log('');

      const overallColor = report.overallScore >= 90
        ? chalk.green
        : report.overallScore >= 70
          ? chalk.yellow
          : chalk.red;

      console.log(`  Overall: ${overallColor(`${report.overallScore} (${report.grade})`)}`);
      console.log('');

      // Criterion bars
      for (const c of report.criteria) {
        const name = c.name.padEnd(20);
        const bar = renderBar(c.score);
        const pct = `${c.score}%`.padStart(4);
        const weight = `(${c.weight.toFixed(2)}w)`;

        const barColor = c.score >= 80
          ? chalk.green
          : c.score >= 60
            ? chalk.yellow
            : chalk.red;

        console.log(`  ${name} ${barColor(bar)}  ${pct}  ${chalk.dim(weight)}`);
      }

      // Recommendations
      if (report.recommendations.length > 0) {
        console.log('');
        console.log(chalk.bold('  Recommendations:'));
        for (const rec of report.recommendations) {
          console.log(`    * ${rec}`);
        }
      }

      console.log('');
    });
}
