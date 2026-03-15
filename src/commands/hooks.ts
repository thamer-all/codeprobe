/**
 * `claude-test hooks [path]` — Detect hooks in the project.
 *
 * Scans for git hooks, Claude hooks, pre-commit configs, and
 * other hook-like configurations.
 */

import { Command } from 'commander';
import { resolvePath } from '../utils/paths.js';
import { walkDirectory, getRelativePath, fileExists, readTextFile } from '../utils/fs.js';
import { join } from 'node:path';
import { setLogLevel } from '../utils/logger.js';
import type { HookInfo } from '../types/agent.js';

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage',
  '.cache', '.turbo',
]);

/** Patterns for detecting hooks. */
const HOOK_PATTERNS: Array<{
  namePattern: RegExp;
  type: string;
  description: string;
}> = [
  {
    namePattern: /^pre-commit$/,
    type: 'git-hook',
    description: 'Git pre-commit hook',
  },
  {
    namePattern: /^pre-push$/,
    type: 'git-hook',
    description: 'Git pre-push hook',
  },
  {
    namePattern: /^commit-msg$/,
    type: 'git-hook',
    description: 'Git commit-msg hook',
  },
  {
    namePattern: /^post-merge$/,
    type: 'git-hook',
    description: 'Git post-merge hook',
  },
  {
    namePattern: /^\.pre-commit-config\.ya?ml$/,
    type: 'pre-commit-config',
    description: 'pre-commit framework configuration',
  },
  {
    namePattern: /^\.husky\/?/,
    type: 'husky',
    description: 'Husky git hooks directory',
  },
  {
    namePattern: /^\.lintstagedrc/,
    type: 'lint-staged',
    description: 'lint-staged configuration',
  },
  {
    namePattern: /hooks?\.(ts|js|ya?ml|json)$/,
    type: 'custom-hook',
    description: 'Custom hook configuration',
  },
  {
    namePattern: /\.claude\/hooks/,
    type: 'claude-hook',
    description: 'Claude Code hook',
  },
];

/**
 * Scan for hooks in a project.
 */
async function hookScanner(rootPath: string): Promise<HookInfo[]> {
  const hooks: HookInfo[] = [];

  // Check .git/hooks
  const gitHooksDir = join(rootPath, '.git', 'hooks');
  if (await fileExists(join(gitHooksDir, 'pre-commit'))) {
    hooks.push({
      path: '.git/hooks/pre-commit',
      type: 'git-hook',
      description: 'Git pre-commit hook',
    });
  }
  if (await fileExists(join(gitHooksDir, 'pre-push'))) {
    hooks.push({
      path: '.git/hooks/pre-push',
      type: 'git-hook',
      description: 'Git pre-push hook',
    });
  }
  if (await fileExists(join(gitHooksDir, 'commit-msg'))) {
    hooks.push({
      path: '.git/hooks/commit-msg',
      type: 'git-hook',
      description: 'Git commit-msg hook',
    });
  }

  // Scan project files
  const entries = await walkDirectory(rootPath, { ignoreDirs: DEFAULT_IGNORE_DIRS });

  for (const entry of entries) {
    const relPath = getRelativePath(rootPath, entry.path);
    const fileName = entry.path.split('/').pop() ?? '';

    for (const pattern of HOOK_PATTERNS) {
      if (pattern.namePattern.test(fileName) || pattern.namePattern.test(relPath)) {
        // Avoid duplicates from git hooks dir
        if (relPath.startsWith('.git/hooks/') && hooks.some((h) => h.path === relPath)) {
          continue;
        }

        const info: HookInfo = {
          path: relPath,
          type: pattern.type,
          description: pattern.description,
        };

        // Try to detect events from config files
        if (entry.isFile && entry.size < 50_000) {
          const content = await readTextFile(entry.path);
          if (content) {
            const events: string[] = [];
            if (/pre-commit/i.test(content)) events.push('pre-commit');
            if (/pre-push/i.test(content)) events.push('pre-push');
            if (/commit-msg/i.test(content)) events.push('commit-msg');
            if (/post-merge/i.test(content)) events.push('post-merge');
            if (events.length > 0) {
              info.events = events;
            }
          }
        }

        hooks.push(info);
        break;
      }
    }
  }

  // Check package.json for husky/lint-staged
  const pkgPath = join(rootPath, 'package.json');
  const pkgContent = await readTextFile(pkgPath);
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent) as Record<string, unknown>;
      if (pkg['husky']) {
        hooks.push({
          path: 'package.json',
          type: 'husky',
          description: 'Husky configuration in package.json',
        });
      }
      if (pkg['lint-staged']) {
        hooks.push({
          path: 'package.json',
          type: 'lint-staged',
          description: 'lint-staged configuration in package.json',
        });
      }
    } catch {
      // Invalid JSON — skip
    }
  }

  return hooks;
}

export function registerHooksCommand(program: Command): void {
  program
    .command('hooks [path]')
    .description('Detect hooks — git hooks, husky, lint-staged, Claude hooks')
    .option('--json', 'Output findings as JSON')
    .action(async (
      pathArg: string | undefined,
      options: { json?: boolean },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? '.');

      const hooks = await hookScanner(targetPath);

      if (options.json) {
        console.log(JSON.stringify(hooks, null, 2));
        return;
      }

      if (hooks.length === 0) {
        console.log(chalk.dim('\nNo hooks detected.\n'));
        return;
      }

      console.log(chalk.bold(`\nHooks Detected (${hooks.length})`));
      console.log('');

      // Group by type
      const grouped = new Map<string, HookInfo[]>();
      for (const hook of hooks) {
        const list = grouped.get(hook.type) ?? [];
        list.push(hook);
        grouped.set(hook.type, list);
      }

      for (const [type, items] of grouped) {
        console.log(chalk.bold(`  ${type}`));
        for (const item of items) {
          let line = `    ${item.path}  ${chalk.dim(item.description)}`;
          if (item.events && item.events.length > 0) {
            line += chalk.cyan(`  [${item.events.join(', ')}]`);
          }
          console.log(line);
        }
        console.log('');
      }
    });
}
