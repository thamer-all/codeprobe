/**
 * `claude-test heatmap [path]` — Token heatmap showing the largest
 * files by estimated token count with ASCII bar charts.
 */

import { Command } from 'commander';
import { resolvePath } from '../utils/paths.js';
import { walkDirectory, getRelativePath } from '../utils/fs.js';
import { estimateTokens } from '../tokenizers/claudeTokenizer.js';
import { readFile } from 'node:fs/promises';
import { formatTokens, formatPercentage, formatBar } from '../utils/output.js';
import { setLogLevel } from '../utils/logger.js';
import type { HeatmapEntry } from '../types/context.js';

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '__pycache__', '.venv', 'vendor',
  '.cache', '.turbo',
]);

/**
 * Build a token heatmap of files.
 */
async function buildHeatmap(
  rootPath: string,
  topN: number,
): Promise<{ entries: HeatmapEntry[]; totalTokens: number }> {
  const walkEntries = await walkDirectory(rootPath, { ignoreDirs: DEFAULT_IGNORE_DIRS });
  const fileEntries = walkEntries.filter((e) => e.isFile && e.size < 1_000_000);

  interface FileData {
    path: string;
    tokens: number;
  }

  const allFiles: FileData[] = [];
  let totalTokens = 0;

  for (const entry of fileEntries) {
    let content: string;
    try {
      content = await readFile(entry.path, 'utf-8');
    } catch {
      continue;
    }

    const tokens = estimateTokens(content);
    totalTokens += tokens;
    allFiles.push({
      path: getRelativePath(rootPath, entry.path),
      tokens,
    });
  }

  allFiles.sort((a, b) => b.tokens - a.tokens);

  const topFiles = allFiles.slice(0, topN);
  const maxTokens = topFiles[0]?.tokens ?? 1;

  const entries: HeatmapEntry[] = topFiles.map((f) => ({
    path: f.path,
    estimatedTokens: f.tokens,
    percentage: totalTokens > 0 ? f.tokens / totalTokens : 0,
    bar: formatBar(f.tokens, maxTokens, 25),
  }));

  return { entries, totalTokens };
}

export function registerHeatmapCommand(program: Command): void {
  program
    .command('heatmap [path]')
    .description('Token heatmap — show largest files by estimated token count')
    .option('--json', 'Output heatmap as JSON')
    .option('--top <n>', 'Number of top files to show', '30')
    .action(async (
      pathArg: string | undefined,
      options: { json?: boolean; top: string },
    ) => {
      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? '.');
      const topN = parseInt(options.top, 10) || 30;

      const { entries, totalTokens } = await buildHeatmap(targetPath, topN);

      if (options.json) {
        console.log(JSON.stringify({ totalTokens, entries }, null, 2));
        return;
      }

      console.log(chalk.bold('\nToken Heatmap'));
      console.log(chalk.dim(`  Root: ${targetPath}`));
      console.log(`  Total tokens: ${formatTokens(totalTokens)}`);
      console.log(`  Showing top ${Math.min(topN, entries.length)} files\n`);

      if (entries.length === 0) {
        console.log(chalk.dim('  No text files found.\n'));
        return;
      }

      // Find the longest path for alignment
      const maxPathLen = Math.min(
        Math.max(...entries.map((e) => e.path.length)),
        50,
      );

      for (const entry of entries) {
        const truncatedPath = entry.path.length > 50
          ? '...' + entry.path.slice(entry.path.length - 47)
          : entry.path;
        const paddedPath = truncatedPath.padEnd(maxPathLen);
        const tokens = formatTokens(entry.estimatedTokens).padStart(8);
        const pct = formatPercentage(entry.percentage).padStart(6);

        // Color the bar based on relative size
        const ratio = entry.estimatedTokens / (entries[0]?.estimatedTokens ?? 1);
        let coloredBar: string;
        if (ratio > 0.7) {
          coloredBar = chalk.red(entry.bar);
        } else if (ratio > 0.3) {
          coloredBar = chalk.yellow(entry.bar);
        } else {
          coloredBar = chalk.green(entry.bar);
        }

        console.log(`  ${paddedPath}  ${coloredBar}  ${tokens}  ${chalk.dim(pct)}`);
      }

      console.log('');
    });
}
