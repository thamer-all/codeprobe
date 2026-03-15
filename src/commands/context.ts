/**
 * `claude-test context [path]` — Analyze repository context usage.
 *
 * Scans the directory tree, estimates token counts per file, and
 * reports a breakdown by extension plus fit estimates for common
 * context windows.
 */

import { Command } from 'commander';
import { resolvePath } from '../utils/paths.js';
import { walkDirectory, getRelativePath } from '../utils/fs.js';
import { estimateTokens } from '../tokenizers/claudeTokenizer.js';
import { readFile, stat } from 'node:fs/promises';
import { formatBytes, formatTokens, formatTable, formatPercentage } from '../utils/output.js';
import { setLogLevel } from '../utils/logger.js';
import type {
  ContextAnalysis,
  ExtensionStats,
  FileTokenInfo,
  FitEstimate,
} from '../types/context.js';

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '__pycache__', '.venv', 'vendor',
  '.cache', '.turbo',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift',
  '.md', '.mdx', '.txt', '.rst', '.adoc',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.csv',
  '.html', '.css', '.scss', '.less', '.sass',
  '.sql', '.graphql', '.gql',
  '.sh', '.bash', '.zsh', '.fish',
  '.env', '.env.example', '.gitignore', '.dockerignore',
  '.dockerfile', '',
]);

const CONTEXT_WINDOWS: Array<{ size: number; label: string }> = [
  { size: 200_000, label: '200k' },
  { size: 1_000_000, label: '1M' },
];

/**
 * Analyze context usage in a directory.
 */
async function contextAnalyzer(rootPath: string): Promise<ContextAnalysis> {
  const entries = await walkDirectory(rootPath, { ignoreDirs: DEFAULT_IGNORE_DIRS });

  const fileEntries = entries.filter((e) => e.isFile);
  const textFiles: FileTokenInfo[] = [];
  const extensionMap = new Map<string, { fileCount: number; totalBytes: number; estimatedTokens: number }>();
  let skippedFiles = 0;
  let totalBytes = 0;
  let totalTokens = 0;

  for (const entry of fileEntries) {
    const ext = entry.extension || '(no ext)';
    const isText = TEXT_EXTENSIONS.has(entry.extension) || entry.size < 50_000;

    if (!isText || entry.size > 1_000_000) {
      skippedFiles++;
      continue;
    }

    let content: string;
    try {
      content = await readFile(entry.path, 'utf-8');
    } catch {
      skippedFiles++;
      continue;
    }

    const tokens = estimateTokens(content);
    totalBytes += entry.size;
    totalTokens += tokens;

    textFiles.push({
      path: getRelativePath(rootPath, entry.path),
      bytes: entry.size,
      estimatedTokens: tokens,
    });

    const existing = extensionMap.get(ext);
    if (existing) {
      existing.fileCount++;
      existing.totalBytes += entry.size;
      existing.estimatedTokens += tokens;
    } else {
      extensionMap.set(ext, { fileCount: 1, totalBytes: entry.size, estimatedTokens: tokens });
    }
  }

  const extensionBreakdown: ExtensionStats[] = Array.from(extensionMap.entries())
    .map(([extension, stats]) => ({ extension, ...stats }))
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens);

  const largestFiles = [...textFiles]
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
    .slice(0, 20);

  const fitEstimates: FitEstimate[] = CONTEXT_WINDOWS.map((w) => ({
    windowSize: w.size,
    windowLabel: w.label,
    fits: totalTokens <= w.size,
    utilization: w.size > 0 ? totalTokens / w.size : 0,
    headroom: w.size - totalTokens,
  }));

  return {
    rootPath,
    totalFiles: fileEntries.length,
    textFiles: textFiles.length,
    skippedFiles,
    totalBytes,
    estimatedTokens: totalTokens,
    extensionBreakdown,
    largestFiles,
    fitEstimates,
  };
}

export { contextAnalyzer };

export function registerContextCommand(program: Command): void {
  program
    .command('context [path]')
    .description('Analyze repository context usage — token counts, extension breakdown, fit estimates')
    .option('--json', 'Output analysis as JSON')
    .option('-v, --verbose', 'Show all files, not just top 20')
    .action(async (
      pathArg: string | undefined,
      options: { json?: boolean; verbose?: boolean },
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

      const analysis = await contextAnalyzer(targetPath);

      if (options.json) {
        console.log(JSON.stringify(analysis, null, 2));
        return;
      }

      console.log(chalk.bold('\nContext Analysis'));
      console.log(chalk.dim(`  Root: ${analysis.rootPath}`));
      console.log('');
      console.log(`  Total files scanned:  ${analysis.totalFiles}`);
      console.log(`  Text files counted:   ${analysis.textFiles}`);
      console.log(`  Skipped files:        ${analysis.skippedFiles}`);
      console.log(`  Total bytes:          ${formatBytes(analysis.totalBytes)}`);
      console.log(`  Estimated tokens:     ${formatTokens(analysis.estimatedTokens)}`);

      // Extension breakdown
      if (analysis.extensionBreakdown.length > 0) {
        console.log(chalk.bold('\n  Extension Breakdown'));
        const extRows = analysis.extensionBreakdown.map((e) => [
          e.extension,
          e.fileCount.toString(),
          formatBytes(e.totalBytes),
          formatTokens(e.estimatedTokens),
        ]);
        const table = formatTable(
          ['Extension', 'Files', 'Size', 'Tokens'],
          extRows,
        );
        for (const line of table.split('\n')) {
          console.log(`  ${line}`);
        }
      }

      // Largest files
      const filesToShow = options.verbose ? analysis.largestFiles : analysis.largestFiles.slice(0, 20);
      if (filesToShow.length > 0) {
        console.log(chalk.bold(`\n  Top ${filesToShow.length} Largest Files by Tokens`));
        const fileRows = filesToShow.map((f) => [
          f.path,
          formatBytes(f.bytes),
          formatTokens(f.estimatedTokens),
        ]);
        const table = formatTable(['File', 'Size', 'Tokens'], fileRows);
        for (const line of table.split('\n')) {
          console.log(`  ${line}`);
        }
      }

      // Fit estimates
      console.log(chalk.bold('\n  Context Window Fit'));
      for (const fit of analysis.fitEstimates) {
        const icon = fit.fits ? chalk.green('YES') : chalk.red('NO');
        const utilPct = formatPercentage(fit.utilization);
        const headroomStr = fit.headroom >= 0
          ? `${formatTokens(fit.headroom)} headroom`
          : `${formatTokens(Math.abs(fit.headroom))} over budget`;
        console.log(`  ${fit.windowLabel}: ${icon}  (${utilPct} utilization, ${headroomStr})`);
      }

      console.log('');
    });
}
