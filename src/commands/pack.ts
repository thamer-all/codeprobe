/**
 * `claude-test pack [path]` — Build a context pack plan.
 *
 * Analyzes the repository and produces a prioritized plan for fitting
 * content into a target context window, with budget breakdowns and
 * optimization suggestions.
 */

import { Command } from 'commander';
import { resolvePath } from '../utils/paths.js';
import { walkDirectory, getRelativePath } from '../utils/fs.js';
import { estimateTokens } from '../tokenizers/claudeTokenizer.js';
import { readFile } from 'node:fs/promises';
import { formatTokens, formatTable, formatPercentage } from '../utils/output.js';
import { loadConfig } from '../utils/config.js';
import { setLogLevel } from '../utils/logger.js';
import type { PackPlan, FileTokenInfo } from '../types/context.js';

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '__pycache__', '.venv', 'vendor',
  '.cache', '.turbo',
]);

const TARGET_SIZES: Record<string, number> = {
  '200k': 200_000,
  '1m': 1_000_000,
};

/** File extensions considered high-priority core code. */
const CORE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
  '.rb', '.c', '.cpp', '.h', '.cs', '.swift', '.kt', '.scala',
]);

/** File extensions considered documentation. */
const DOC_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.rst', '.adoc',
]);

/**
 * Build a context pack plan.
 */
async function contextPacker(
  rootPath: string,
  targetLabel: string,
): Promise<PackPlan> {
  const config = await loadConfig(rootPath);
  const rawBudgets = config.contextBudgets ?? {
    systemPrompt: 10,
    coreFiles: 50,
    docs: 20,
    toolMeta: 10,
  };

  // Normalize: if values are > 1, they're percentages (e.g. 10 = 10%); convert to fractions
  const normalize = (v: number | undefined, fallback: number): number => {
    const val = v ?? fallback;
    return val > 1 ? val / 100 : val;
  };

  const targetSize = TARGET_SIZES[targetLabel.toLowerCase()];
  if (!targetSize) {
    throw new Error(`Unknown target: ${targetLabel}. Use "200k" or "1m".`);
  }

  const systemPromptBudget = Math.floor(targetSize * normalize(rawBudgets.systemPrompt, 10));
  const coreFilesBudget = Math.floor(targetSize * normalize(rawBudgets.coreFiles, 50));
  const docsBudget = Math.floor(targetSize * normalize(rawBudgets.docs, 20));
  const toolMetaBudget = Math.floor(targetSize * normalize(rawBudgets.toolMeta, 10));
  const remainingFree = targetSize - systemPromptBudget - coreFilesBudget - docsBudget - toolMetaBudget;

  const entries = await walkDirectory(rootPath, { ignoreDirs: DEFAULT_IGNORE_DIRS });
  const fileEntries = entries.filter((e) => e.isFile && e.size < 1_000_000);

  const allFiles: FileTokenInfo[] = [];

  for (const entry of fileEntries) {
    try {
      const content = await readFile(entry.path, 'utf-8');
      const tokens = estimateTokens(content);
      allFiles.push({
        path: getRelativePath(rootPath, entry.path),
        bytes: entry.size,
        estimatedTokens: tokens,
      });
    } catch {
      // Skip unreadable files
    }
  }

  // Sort by token count descending
  allFiles.sort((a, b) => b.estimatedTokens - a.estimatedTokens);

  const totalEstimatedTokens = allFiles.reduce((sum, f) => sum + f.estimatedTokens, 0);

  // Classify files into include / summarize / exclude
  const includeFirst: FileTokenInfo[] = [];
  const summarize: FileTokenInfo[] = [];
  const exclude: FileTokenInfo[] = [];

  let usedTokens = 0;
  const coreLimit = coreFilesBudget + docsBudget + remainingFree;

  for (const file of allFiles) {
    const ext = '.' + file.path.split('.').pop();
    const isCore = CORE_EXTENSIONS.has(ext);
    const isDoc = DOC_EXTENSIONS.has(ext);

    if (usedTokens + file.estimatedTokens <= coreLimit) {
      if (isCore || isDoc) {
        includeFirst.push(file);
      } else {
        includeFirst.push(file);
      }
      usedTokens += file.estimatedTokens;
    } else if (file.estimatedTokens > 2000) {
      summarize.push(file);
    } else {
      exclude.push(file);
    }
  }

  return {
    target: targetSize,
    targetLabel,
    systemPromptBudget,
    coreFilesBudget,
    docsBudget,
    toolMetaBudget,
    remainingFree,
    includeFirst,
    summarize,
    exclude,
    totalEstimatedTokens,
  };
}

export function registerPackCommand(program: Command): void {
  program
    .command('pack [path]')
    .description('Build a context pack plan — prioritize files for inclusion in context windows')
    .option('--json', 'Output pack plan as JSON')
    .option('--target <target>', 'Target context window: 200k or 1m', '1m')
    .option('--optimize', 'Show optimization suggestions')
    .action(async (
      pathArg: string | undefined,
      options: { json?: boolean; target: string; optimize?: boolean },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? '.');

      const plan = await contextPacker(targetPath, options.target);

      if (options.json) {
        console.log(JSON.stringify(plan, null, 2));
        return;
      }

      console.log(chalk.bold('\nContext Pack Plan'));
      console.log(chalk.dim(`  Target: ${plan.targetLabel} (${formatTokens(plan.target)} tokens)`));
      console.log(`  Total estimated tokens: ${formatTokens(plan.totalEstimatedTokens)}`);
      console.log('');

      // Budget breakdown
      console.log(chalk.bold('  Budget Breakdown'));
      const budgetRows = [
        ['System prompt', formatTokens(plan.systemPromptBudget), formatPercentage(plan.systemPromptBudget / plan.target)],
        ['Core files', formatTokens(plan.coreFilesBudget), formatPercentage(plan.coreFilesBudget / plan.target)],
        ['Documentation', formatTokens(plan.docsBudget), formatPercentage(plan.docsBudget / plan.target)],
        ['Tool/meta', formatTokens(plan.toolMetaBudget), formatPercentage(plan.toolMetaBudget / plan.target)],
        ['Free/overflow', formatTokens(plan.remainingFree), formatPercentage(plan.remainingFree / plan.target)],
      ];
      const budgetTable = formatTable(['Category', 'Tokens', 'Share'], budgetRows);
      for (const line of budgetTable.split('\n')) {
        console.log(`  ${line}`);
      }

      // Files to include
      if (plan.includeFirst.length > 0) {
        console.log(chalk.bold(`\n  Include First (${plan.includeFirst.length} files)`));
        const includeRows = plan.includeFirst.slice(0, 30).map((f) => [
          f.path,
          formatTokens(f.estimatedTokens),
        ]);
        const table = formatTable(['File', 'Tokens'], includeRows);
        for (const line of table.split('\n')) {
          console.log(`  ${line}`);
        }
        if (plan.includeFirst.length > 30) {
          console.log(chalk.dim(`  ... and ${plan.includeFirst.length - 30} more files`));
        }
      }

      // Files to summarize
      if (plan.summarize.length > 0) {
        console.log(chalk.bold(`\n  Summarize (${plan.summarize.length} files)`));
        const sumRows = plan.summarize.slice(0, 20).map((f) => [
          f.path,
          formatTokens(f.estimatedTokens),
        ]);
        const table = formatTable(['File', 'Tokens'], sumRows);
        for (const line of table.split('\n')) {
          console.log(`  ${line}`);
        }
      }

      // Excluded count
      if (plan.exclude.length > 0) {
        console.log(chalk.dim(`\n  Excluded: ${plan.exclude.length} files`));
      }

      // Optimization tips
      if (options.optimize) {
        console.log(chalk.bold('\n  Optimization Tips'));
        const tips: string[] = [];

        if (plan.totalEstimatedTokens > plan.target) {
          tips.push('Repository exceeds target. Consider splitting into focused context packs per task.');
        }

        const largeFiles = plan.includeFirst.filter((f) => f.estimatedTokens > 5000);
        if (largeFiles.length > 0) {
          tips.push(`${largeFiles.length} large files (>5k tokens) could benefit from summarization.`);
        }

        if (plan.summarize.length > 10) {
          tips.push('Many files marked for summarization. Consider creating a CLAUDE.md index.');
        }

        if (tips.length === 0) {
          tips.push('No specific optimization needed. Context pack looks well-sized.');
        }

        for (const tip of tips) {
          console.log(`    * ${tip}`);
        }
      }

      console.log('');
    });
}
