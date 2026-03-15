/**
 * Context analyzer — recursively walks a directory, estimates token counts,
 * and produces a comprehensive analysis of how a codebase fits into
 * Claude's context windows.
 */

import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

import type {
  ContextAnalysis,
  ExtensionStats,
  FileTokenInfo,
  FitEstimate,
} from '../types/context.js';
import type { ClaudeTestConfig } from '../types/config.js';
import { walkDirectory } from '../utils/fs.js';
import { readTextFile } from '../utils/fs.js';
import { estimateTokens } from '../tokenizers/claudeTokenizer.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// .gitignore parsing
// ---------------------------------------------------------------------------

/**
 * Load directory/file name patterns from a .gitignore file.
 *
 * This is intentionally simplified — it extracts plain directory and file
 * names (no glob expansion). Patterns containing wildcards after cleanup
 * are skipped. This is sufficient for the common cases like `dist/`,
 * `coverage/`, `.cache/`, etc.
 */
async function loadGitignorePatterns(rootPath: string): Promise<Set<string>> {
  const patterns = new Set<string>();
  const gitignorePath = resolve(rootPath, '.gitignore');
  try {
    const content = await readFile(gitignorePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      // Extract directory/file name (strip leading/trailing slashes and wildcards)
      const clean = trimmed.replace(/^\//, '').replace(/\/\*?$/, '').replace(/^\*\*\//, '');
      if (clean && !clean.includes('*')) {
        patterns.add(clean);
      }
    }
  } catch {
    // No .gitignore or unreadable — fine
  }
  return patterns;
}

// ---------------------------------------------------------------------------
// Paths and extensions to ignore
// ---------------------------------------------------------------------------

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.DS_Store',
  '__pycache__',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.vercel',
  'vendor',
  '.venv',
  'env',
  '.env',
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp3',
  '.mp4',
  '.zip',
  '.tar',
  '.gz',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.class',
  '.pyc',
  '.o',
  '.obj',
  '.bin',
  '.dat',
  '.sqlite',
  '.db',
]);

// ---------------------------------------------------------------------------
// Context window definitions
// ---------------------------------------------------------------------------

const CONTEXT_WINDOWS: Array<{ size: number; label: string }> = [
  { size: 200_000, label: '200k' },
  { size: 1_000_000, label: '1M' },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a directory tree and produce a comprehensive context usage report.
 *
 * - Recursively walks directories, skipping ignored paths
 * - Detects binary files by extension
 * - Reads text files and estimates token counts
 * - Builds per-extension breakdowns
 * - Identifies the largest files
 * - Calculates fit estimates for 200k and 1M context windows
 */
export async function analyzeContext(
  rootPath: string,
  config?: ClaudeTestConfig,
): Promise<ContextAnalysis> {
  const absoluteRoot = resolve(rootPath);
  logger.debug(`Analyzing context for: ${absoluteRoot}`);

  // Build the set of directories to ignore
  const ignoreDirs = new Set(DEFAULT_IGNORE_DIRS);
  if (config?.ignorePaths) {
    for (const p of config.ignorePaths) {
      ignoreDirs.add(p);
    }
  }

  // Merge patterns from .gitignore (if present)
  const gitignorePatterns = await loadGitignorePatterns(absoluteRoot);
  for (const pattern of gitignorePatterns) {
    ignoreDirs.add(pattern);
  }
  if (gitignorePatterns.size > 0) {
    logger.debug(`Loaded ${gitignorePatterns.size} pattern(s) from .gitignore`);
  }

  // Walk the directory tree
  const entries = await walkDirectory(absoluteRoot, { ignoreDirs });

  // Process only files
  const fileEntries = entries.filter((e) => e.isFile);

  let totalFiles = 0;
  let textFiles = 0;
  let skippedFiles = 0;
  let totalBytes = 0;
  let estimatedTokens = 0;

  const extensionMap = new Map<
    string,
    { fileCount: number; totalBytes: number; estimatedTokens: number }
  >();

  const fileTokenInfos: FileTokenInfo[] = [];

  for (const entry of fileEntries) {
    totalFiles++;
    totalBytes += entry.size;

    // Skip binary files
    if (BINARY_EXTENSIONS.has(entry.extension)) {
      skippedFiles++;
      continue;
    }

    // Try to read as text
    const content = await readTextFile(entry.path);
    if (content === null) {
      skippedFiles++;
      continue;
    }

    textFiles++;
    const tokens = estimateTokens(content);
    estimatedTokens += tokens;

    // Track per-extension stats
    const ext = entry.extension || '(no extension)';
    const existing = extensionMap.get(ext);
    if (existing) {
      existing.fileCount++;
      existing.totalBytes += entry.size;
      existing.estimatedTokens += tokens;
    } else {
      extensionMap.set(ext, {
        fileCount: 1,
        totalBytes: entry.size,
        estimatedTokens: tokens,
      });
    }

    // Track file token info for largest-file ranking
    fileTokenInfos.push({
      path: entry.relativePath,
      bytes: entry.size,
      estimatedTokens: tokens,
    });
  }

  // Build extension breakdown sorted by token count descending
  const extensionBreakdown: ExtensionStats[] = Array.from(
    extensionMap.entries(),
  )
    .map(([extension, stats]) => ({
      extension,
      fileCount: stats.fileCount,
      totalBytes: stats.totalBytes,
      estimatedTokens: stats.estimatedTokens,
    }))
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens);

  // Find the top 20 largest files by token count
  const largestFiles = fileTokenInfos
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
    .slice(0, 20);

  // Calculate fit estimates for each context window
  const fitEstimates: FitEstimate[] = CONTEXT_WINDOWS.map((window) => {
    const fits = estimatedTokens <= window.size;
    const utilization =
      window.size > 0 ? estimatedTokens / window.size : 0;
    const headroom = window.size > 0 ? 1 - utilization : 0;

    return {
      windowSize: window.size,
      windowLabel: window.label,
      fits,
      utilization: Math.min(utilization, 1),
      headroom: Math.max(headroom, 0),
    };
  });

  logger.debug(
    `Analysis complete: ${totalFiles} files, ${textFiles} text, ${skippedFiles} skipped, ~${estimatedTokens} tokens`,
  );

  return {
    rootPath: absoluteRoot,
    totalFiles,
    textFiles,
    skippedFiles,
    totalBytes,
    estimatedTokens,
    extensionBreakdown,
    largestFiles,
    fitEstimates,
  };
}
