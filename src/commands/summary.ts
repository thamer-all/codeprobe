/**
 * `codeprobe summary [path]` — Quick, compact project summary.
 *
 * Like `git status` but for AI context. Fast, one-screen output
 * with the most important facts about the project.
 */

import { Command } from 'commander';
import { resolve, basename } from 'node:path';
import { stat } from 'node:fs/promises';
import { resolvePath } from '../utils/paths.js';
import { setLogLevel } from '../utils/logger.js';
import { analyzeContext } from '../core/contextAnalyzer.js';
import { scanForClaudeAssets } from '../core/agentTracer.js';
import { formatTokens } from '../utils/output.js';
import { readTextFile, fileExists, isDirectory } from '../utils/fs.js';

// ── Inline lint check (error-severity only) ─────────────────────────

async function countLintErrors(targetPath: string): Promise<number> {
  const yaml = (await import('js-yaml')).default;
  const { glob } = await import('glob');

  let files: string[];
  if (await fileExists(targetPath)) {
    files = [targetPath];
  } else if (await isDirectory(targetPath)) {
    files = await glob(resolve(targetPath, '**/*.prompt.{yaml,yml}'), { absolute: true });
  } else {
    return 0;
  }

  let errorCount = 0;
  for (const file of files) {
    const content = await readTextFile(file);
    if (!content) { errorCount++; continue; }

    let parsed: Record<string, unknown>;
    try {
      parsed = yaml.load(content) as Record<string, unknown>;
    } catch {
      errorCount++;
      continue;
    }

    if (!parsed || typeof parsed !== 'object') { errorCount++; continue; }
    if (!parsed['prompt']) { errorCount++; }
  }

  return errorCount;
}

// ── Inline security check (critical+high only) ─────────────────────

const SECURITY_PATTERNS: Array<{ pattern: RegExp; severity: string }> = [
  { pattern: /ignore\s+(previous|above|all)\s+(instructions?|prompts?|rules?)/i, severity: 'critical' },
  { pattern: /pretend\s+(you\s+are|to\s+be|that)/i, severity: 'high' },
  { pattern: /system\s*:\s*you\s+are\s+now/i, severity: 'critical' },
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}/i, severity: 'critical' },
  { pattern: /(?:secret|password|token|credential)\s*[:=]\s*['"][^'"]{8,}/i, severity: 'critical' },
  { pattern: /(?:sk-|pk_|rk_|ghp_|gho_|github_pat_)[A-Za-z0-9_\-]{20,}/, severity: 'critical' },
  { pattern: /eval\s*\(|exec\s*\(|Function\s*\(/, severity: 'high' },
  { pattern: /send\s+(to|data|all|everything)\s+(to\s+)?https?:\/\//i, severity: 'high' },
];

async function countSecurityIssues(targetPath: string): Promise<number> {
  const { glob } = await import('glob');

  let files: string[];
  if (await fileExists(targetPath)) {
    files = [targetPath];
  } else if (await isDirectory(targetPath)) {
    files = await glob(resolve(targetPath, '**/*.{yaml,yml,json,md}'), {
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });
  } else {
    return 0;
  }

  let count = 0;
  for (const file of files) {
    const content = await readTextFile(file);
    if (!content) continue;
    const lines = content.split('\n');
    for (const line of lines) {
      for (const rule of SECURITY_PATTERNS) {
        if (rule.pattern.test(line)) {
          count++;
        }
      }
    }
  }
  return count;
}

// ── Detect primary language ─────────────────────────────────────────

function detectLanguage(extensionBreakdown: Array<{ extension: string; estimatedTokens: number }>): string {
  if (extensionBreakdown.length === 0) return 'Unknown';

  const langMap: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript/React',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript/React',
    '.py': 'Python',
    '.rb': 'Ruby',
    '.go': 'Go',
    '.rs': 'Rust',
    '.java': 'Java',
    '.kt': 'Kotlin',
    '.swift': 'Swift',
    '.cs': 'C#',
    '.cpp': 'C++',
    '.c': 'C',
    '.php': 'PHP',
    '.scala': 'Scala',
  };

  // Find the top code extension (skip config/doc extensions)
  const configExts = new Set(['.json', '.yaml', '.yml', '.toml', '.xml', '.md', '.mdx', '.txt', '.css', '.scss', '.html', '.sql', '.sh', '.env']);
  for (const ext of extensionBreakdown) {
    if (!configExts.has(ext.extension) && langMap[ext.extension]) {
      return langMap[ext.extension]!;
    }
  }

  // Fallback: just use the top extension
  const topExt = extensionBreakdown[0]!.extension;
  return langMap[topExt] ?? topExt;
}

function detectRuntime(extensionBreakdown: Array<{ extension: string; estimatedTokens: number }>): string {
  const exts = new Set(extensionBreakdown.map((e) => e.extension));
  if (exts.has('.ts') || exts.has('.tsx') || exts.has('.js') || exts.has('.jsx')) return 'Node.js';
  if (exts.has('.py')) return 'Python';
  if (exts.has('.go')) return 'Go';
  if (exts.has('.rs')) return 'Rust';
  if (exts.has('.java') || exts.has('.kt')) return 'JVM';
  if (exts.has('.rb')) return 'Ruby';
  if (exts.has('.swift')) return 'Swift';
  if (exts.has('.cs')) return '.NET';
  return '';
}

// ── Summary JSON output ─────────────────────────────────────────────

interface SummaryData {
  name: string;
  path: string;
  files: number;
  tokens: number;
  language: string;
  runtime: string;
  contextFit: Array<{ window: string; size: number; percentage: number; fits: boolean }>;
  aiTools: string[];
  lintIssues: number;
  securityIssues: number;
}

// ── Main command ────────────────────────────────────────────────────

export function registerSummaryCommand(program: Command): void {
  program
    .command('summary')
    .argument('[path]', 'Path to summarize', '.')
    .description('Quick, compact project summary — files, tokens, context fit, AI tools')
    .option('--json', 'Output summary as JSON')
    .action(async (pathArg: string, options: { json?: boolean }) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const targetPath = resolvePath(pathArg);

      // Verify path exists
      try {
        const s = await stat(targetPath);
        if (!s.isDirectory()) {
          console.error(`Error: not a directory: ${targetPath}`);
          process.exitCode = 1;
          return;
        }
      } catch {
        console.error(`Error: path not found: ${targetPath}`);
        process.exitCode = 1;
        return;
      }

      // Run analysis and asset scan in parallel
      const [analysis, assets, lintErrors, securityCount] = await Promise.all([
        analyzeContext(targetPath),
        scanForClaudeAssets(targetPath),
        countLintErrors(targetPath).catch(() => 0),
        countSecurityIssues(targetPath).catch(() => 0),
      ]);

      const projectName = basename(targetPath);
      const language = detectLanguage(analysis.extensionBreakdown);
      const runtime = detectRuntime(analysis.extensionBreakdown);
      const langRuntime = runtime ? `${language}/${runtime}` : language;

      // AI tools detected
      const toolLabels: Record<string, string> = {
        'claude-config': 'Claude Code',
        'cursor-config': 'Cursor',
        'windsurf-config': 'Windsurf',
        'copilot-config': 'GitHub Copilot',
        'aider-config': 'Aider',
        'continue-config': 'Continue',
        'cline-config': 'Cline',
        'codex-config': 'Codex',
      };

      const aiToolNames = new Set<string>();
      for (const asset of assets) {
        const label = toolLabels[asset.type];
        if (label) {
          aiToolNames.add(label);
        }
      }

      // Context fit info
      const contextWindows = [
        { window: '200k', size: 200_000, label: 'Claude (200k)' },
        { window: '1M', size: 1_000_000, label: 'Claude/Gemini (1M)' },
        { window: '128k', size: 128_000, label: 'GPT-4o (128k)' },
      ];

      const fitInfo = contextWindows.map((w) => {
        const pct = Math.round((analysis.estimatedTokens / w.size) * 100);
        const fits = analysis.estimatedTokens <= w.size;
        return { ...w, percentage: pct, fits };
      });

      // Has CLAUDE.md?
      const claudeMdAsset = assets.find((a) =>
        a.path.endsWith('CLAUDE.md') || a.path.endsWith('claude.md'),
      );
      const claudeMdLabel = claudeMdAsset ? 'CLAUDE.md' : null;

      // JSON output
      if (options.json) {
        const data: SummaryData = {
          name: projectName,
          path: targetPath,
          files: analysis.totalFiles,
          tokens: analysis.estimatedTokens,
          language,
          runtime,
          contextFit: fitInfo.map((f) => ({
            window: f.window,
            size: f.size,
            percentage: f.percentage,
            fits: f.fits,
          })),
          aiTools: Array.from(aiToolNames),
          lintIssues: lintErrors,
          securityIssues: securityCount,
        };
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      // Human-friendly output
      const chalk = (await import('chalk')).default;

      console.log('');

      // Line 1: project name @ path
      console.log(`  ${chalk.bold(projectName)} ${chalk.dim('@')} ${targetPath}`);

      // Line 2: files | tokens | language
      console.log(`  ${analysis.totalFiles} files | ${formatTokens(analysis.estimatedTokens)} tokens | ${langRuntime}`);

      console.log('');

      // Context fit line
      const fitParts = fitInfo.map((f) => {
        const icon = f.fits ? chalk.green('\u2713') : chalk.red('\u2717');
        return `${f.label}: ${f.percentage}% ${icon}`;
      });
      console.log(`  Context: ${fitParts.join('  ')}`);

      // AI tools line
      const toolList = aiToolNames.size > 0
        ? Array.from(aiToolNames).join(', ')
        : chalk.dim('none detected');
      const claudeMdSuffix = claudeMdLabel ? ` (${claudeMdLabel})` : '';
      console.log(`  AI Tools: ${toolList}${claudeMdSuffix}`);

      // Quality line
      const lintLabel = lintErrors === 0
        ? chalk.green(`${lintErrors} lint issues`)
        : chalk.red(`${lintErrors} lint issues`);
      const secLabel = securityCount === 0
        ? chalk.green(`${securityCount} security issues`)
        : chalk.red(`${securityCount} security issues`);
      console.log(`  Quality: ${lintLabel}, ${secLabel}`);

      console.log('');
    });
}
