/**
 * `claude-test simulate [path]` — Simulate context fit against
 * target context windows.
 */

import { Command } from 'commander';
import { resolvePath } from '../utils/paths.js';
import { walkDirectory } from '../utils/fs.js';
import { estimateTokens } from '../tokenizers/claudeTokenizer.js';
import { readFile, stat } from 'node:fs/promises';
import { formatTokens, formatPercentage } from '../utils/output.js';
import { setLogLevel } from '../utils/logger.js';
import { getModel } from '../core/modelRegistry.js';
import type { SimulationResult, SimulationTarget } from '../types/context.js';

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '__pycache__', '.venv', 'vendor',
  '.cache', '.turbo',
]);

const TARGETS: Array<{ size: number; label: string }> = [
  { size: 200_000, label: '200k' },
  { size: 1_000_000, label: '1M' },
];

/**
 * Run a repository simulation.
 */
async function repositorySimulator(
  rootPath: string,
  targetFilter?: string,
  customTargets?: Array<{ size: number; label: string }>,
): Promise<SimulationResult> {
  const entries = await walkDirectory(rootPath, { ignoreDirs: DEFAULT_IGNORE_DIRS });
  const fileEntries = entries.filter((e) => e.isFile && e.size < 1_000_000);

  let totalTokens = 0;

  for (const entry of fileEntries) {
    try {
      const content = await readFile(entry.path, 'utf-8');
      totalTokens += estimateTokens(content);
    } catch {
      // Skip unreadable files
    }
  }

  // Use custom targets (from --model) if provided, otherwise default targets
  const baseTargets = customTargets ?? TARGETS;

  const activeTargets = targetFilter
    ? baseTargets.filter((t) => t.label.toLowerCase() === targetFilter.toLowerCase())
    : baseTargets;

  if (activeTargets.length === 0) {
    throw new Error(`Unknown target: ${targetFilter}. Use "200k" or "1m".`);
  }

  // Reserve ~20% for system prompt, tool defs, etc.
  const reserveRatio = 0.2;

  const targets: SimulationTarget[] = activeTargets.map((t) => {
    const reservedBudget = Math.floor(t.size * reserveRatio);
    const available = t.size - reservedBudget;
    return {
      windowSize: t.size,
      windowLabel: t.label,
      fits: totalTokens <= available,
      utilization: available > 0 ? totalTokens / available : 0,
      headroom: available - totalTokens,
      reservedBudget,
    };
  });

  const recommendations: string[] = [];
  if (totalTokens > 200_000) {
    recommendations.push('Consider using `claude-test pack` to build an optimized context plan.');
  }
  if (totalTokens > 1_000_000) {
    recommendations.push('Repository exceeds 1M tokens. Focus on core files and use summaries for large docs.');
  }
  if (totalTokens < 50_000) {
    recommendations.push('Repository fits comfortably. You can include the full codebase as context.');
  }

  return {
    rootPath,
    totalTokens,
    targets,
    recommendations,
  };
}

export function registerSimulateCommand(program: Command): void {
  program
    .command('simulate [path]')
    .description('Simulate context fit — estimate whether repo fits in target context windows')
    .option('--json', 'Output simulation as JSON')
    .option('--target <target>', 'Target context window: 200k or 1m')
    .option('--model <model>', 'Simulate against a specific model\'s context window')
    .action(async (
      pathArg: string | undefined,
      options: { json?: boolean; target?: string; model?: string },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? '.');

      try {
        await stat(targetPath);
      } catch {
        console.error(`Error: path not found: ${targetPath}`);
        process.exitCode = 1;
        return;
      }

      // If --model is provided, use that model's context window as the target
      let customTargets: Array<{ size: number; label: string }> | undefined;
      if (options.model) {
        const modelInfo = getModel(options.model);
        if (!modelInfo) {
          console.error(`Error: unknown model "${options.model}". Use a model id from the registry (e.g., gpt-4o, claude-sonnet-4-6, gemini-2.5-pro).`);
          process.exitCode = 1;
          return;
        }
        const windowSize = modelInfo.contextWindow;
        const label = `${modelInfo.name} (${Math.round(windowSize / 1000)}k)`;
        customTargets = [{ size: windowSize, label }];
      }

      const result = await repositorySimulator(targetPath, options.target, customTargets);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.bold('\nContext Simulation'));
      console.log(chalk.dim(`  Root: ${result.rootPath}`));
      console.log(`  Total tokens: ${formatTokens(result.totalTokens)}`);
      console.log('');

      for (const target of result.targets) {
        const fitsIcon = target.fits ? chalk.green('FITS') : chalk.red('DOES NOT FIT');
        console.log(chalk.bold(`  ${target.windowLabel} window:`));
        console.log(`    Status:       ${fitsIcon}`);
        console.log(`    Utilization:  ${formatPercentage(target.utilization)}`);
        console.log(`    Reserved:     ${formatTokens(target.reservedBudget)} (system/tools)`);
        if (target.headroom >= 0) {
          console.log(`    Headroom:     ${chalk.green(formatTokens(target.headroom))}`);
        } else {
          console.log(`    Over budget:  ${chalk.red(formatTokens(Math.abs(target.headroom)))}`);
        }
        console.log('');
      }

      if (result.recommendations.length > 0) {
        console.log(chalk.bold('  Recommendations'));
        for (const rec of result.recommendations) {
          console.log(`    * ${rec}`);
        }
        console.log('');
      }
    });
}
