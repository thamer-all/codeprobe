/**
 * `claude-test map [path]` — Repository context map.
 *
 * Shows directory-level token distribution as a tree with bar
 * visualizations.
 */

import { Command } from 'commander';
import { resolvePath } from '../utils/paths.js';
import { walkDirectory, getRelativePath } from '../utils/fs.js';
import { estimateTokens } from '../tokenizers/claudeTokenizer.js';
import { readFile } from 'node:fs/promises';
import { formatTokens, formatPercentage, formatBar } from '../utils/output.js';
import { setLogLevel } from '../utils/logger.js';
import { dirname } from 'node:path';
import type { ContextMap, DirectoryTokenInfo } from '../types/context.js';

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '__pycache__', '.venv', 'vendor',
  '.cache', '.turbo',
]);

/**
 * Build a context map of directory-level token distribution.
 */
async function buildContextMap(
  rootPath: string,
  maxDepth: number,
): Promise<ContextMap> {
  const entries = await walkDirectory(rootPath, { ignoreDirs: DEFAULT_IGNORE_DIRS });
  const fileEntries = entries.filter((e) => e.isFile && e.size < 1_000_000);

  const dirTokens = new Map<string, { tokens: number; fileCount: number }>();
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

    const relPath = getRelativePath(rootPath, entry.path);
    const relDir = dirname(relPath);

    // Walk up the directory chain, accumulating tokens at each level
    const parts = relDir === '.' ? [] : relDir.split('/');
    for (let depth = 0; depth <= Math.min(parts.length, maxDepth); depth++) {
      const dirKey = depth === 0 ? '.' : parts.slice(0, depth).join('/');
      const existing = dirTokens.get(dirKey) ?? { tokens: 0, fileCount: 0 };
      existing.tokens += tokens;
      existing.fileCount++;
      dirTokens.set(dirKey, existing);
    }
  }

  const directories: DirectoryTokenInfo[] = Array.from(dirTokens.entries())
    .map(([path, data]) => ({
      path,
      fileCount: data.fileCount,
      estimatedTokens: data.tokens,
      percentage: totalTokens > 0 ? data.tokens / totalTokens : 0,
    }))
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens);

  return {
    rootPath,
    totalTokens,
    directories,
  };
}

export function registerMapCommand(program: Command): void {
  program
    .command('map [path]')
    .description('Repository context map — directory-level token distribution')
    .option('--json', 'Output map as JSON')
    .option('--depth <n>', 'Maximum directory depth', '3')
    .action(async (
      pathArg: string | undefined,
      options: { json?: boolean; depth: string },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? '.');
      const maxDepth = parseInt(options.depth, 10) || 3;

      const contextMap = await buildContextMap(targetPath, maxDepth);

      if (options.json) {
        console.log(JSON.stringify(contextMap, null, 2));
        return;
      }

      console.log(chalk.bold('\nContext Map'));
      console.log(chalk.dim(`  Root: ${contextMap.rootPath}`));
      console.log(`  Total tokens: ${formatTokens(contextMap.totalTokens)}`);
      console.log('');

      if (contextMap.directories.length === 0) {
        console.log(chalk.dim('  No text files found.\n'));
        return;
      }

      // Filter to show only top-level and second-level directories
      // (skip the root "." entry to avoid redundancy with total)
      const display = contextMap.directories
        .filter((d) => d.path !== '.')
        .slice(0, 30);

      const maxTokens = Math.max(...display.map((d) => d.estimatedTokens), 1);

      for (const dir of display) {
        const depth = dir.path.split('/').length - 1;
        const indent = '  '.repeat(depth + 1);
        const bar = formatBar(dir.estimatedTokens, maxTokens, 20);
        const pct = formatPercentage(dir.percentage);
        const tokens = formatTokens(dir.estimatedTokens);

        console.log(
          `${indent}${chalk.bold(dir.path + '/')}  ${bar}  ${tokens}  ${chalk.dim(pct)}  ${chalk.dim(`(${dir.fileCount} files)`)}`,
        );
      }

      console.log('');
    });
}
