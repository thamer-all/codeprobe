/**
 * `claude-test lint [path]` — Lint prompt spec files for common issues.
 */

import { Command } from 'commander';
import { resolve } from 'node:path';
import { resolvePath } from '../utils/paths.js';
import { readTextFile, isDirectory, fileExists, getRelativePath as getRelPath } from '../utils/fs.js';
import { setLogLevel } from '../utils/logger.js';
import type { LintWarning } from '../types/diagnostics.js';

/**
 * Find all prompt spec files in a directory.
 */
async function findSpecFiles(dirPath: string): Promise<string[]> {
  const { glob } = await import('glob');
  const pattern = resolve(dirPath, '**/*.prompt.{yaml,yml}');
  return glob(pattern, { absolute: true });
}

/**
 * Lint a single prompt spec file.
 */
async function lintFile(filePath: string, rootPath: string): Promise<LintWarning[]> {
  const yaml = (await import('js-yaml')).default;
  const warnings: LintWarning[] = [];
  const relPath = getRelPath(rootPath, filePath);

  const content = await readTextFile(filePath);
  if (!content) {
    warnings.push({
      file: relPath,
      rule: 'file-read',
      severity: 'error',
      message: 'Could not read file',
    });
    return warnings;
  }

  // Parse YAML
  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(content) as Record<string, unknown>;
  } catch (err) {
    warnings.push({
      file: relPath,
      rule: 'yaml-parse',
      severity: 'error',
      message: `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
    });
    return warnings;
  }

  if (!parsed || typeof parsed !== 'object') {
    warnings.push({
      file: relPath,
      rule: 'yaml-parse',
      severity: 'error',
      message: 'YAML did not parse to an object',
    });
    return warnings;
  }

  // Check required fields
  if (!parsed['name']) {
    warnings.push({
      file: relPath,
      rule: 'missing-name',
      severity: 'warning',
      message: 'Missing "name" field',
    });
  }

  if (!parsed['prompt']) {
    warnings.push({
      file: relPath,
      rule: 'missing-prompt',
      severity: 'error',
      message: 'Missing "prompt" field — every spec needs a prompt',
    });
  }

  // Check prompt quality
  const prompt = parsed['prompt'];
  if (typeof prompt === 'string') {
    if (prompt.length < 10) {
      warnings.push({
        file: relPath,
        rule: 'short-prompt',
        severity: 'warning',
        message: 'Prompt is very short (< 10 characters). Consider adding more detail.',
      });
    }

    if (prompt.length > 10_000) {
      warnings.push({
        file: relPath,
        rule: 'long-prompt',
        severity: 'info',
        message: `Prompt is very long (${prompt.length} chars). Consider splitting into system + prompt.`,
      });
    }

    if (!parsed['system'] && prompt.includes('You are')) {
      warnings.push({
        file: relPath,
        rule: 'system-in-prompt',
        severity: 'info',
        message: 'Prompt contains "You are" — consider moving persona to the "system" field.',
      });
    }
  }

  // Check model
  if (parsed['model'] && typeof parsed['model'] === 'string') {
    const model = parsed['model'];
    if (!model.startsWith('claude-') && !model.startsWith('gpt-') && !model.includes('/')) {
      warnings.push({
        file: relPath,
        rule: 'unknown-model',
        severity: 'warning',
        message: `Unknown model format: "${model}". Expected claude-*, gpt-*, or provider/model.`,
      });
    }
  }

  // Check tests
  if (!parsed['tests'] || !Array.isArray(parsed['tests'])) {
    warnings.push({
      file: relPath,
      rule: 'no-tests',
      severity: 'warning',
      message: 'No tests defined. Add tests to validate prompt behavior.',
    });
  } else {
    const tests = parsed['tests'] as Array<Record<string, unknown>>;
    for (let i = 0; i < tests.length; i++) {
      const test = tests[i]!;
      if (!test['name']) {
        warnings.push({
          file: relPath,
          rule: 'test-missing-name',
          severity: 'warning',
          message: `Test at index ${i} is missing a "name" field.`,
        });
      }
      if (!test['expect']) {
        warnings.push({
          file: relPath,
          rule: 'test-no-expect',
          severity: 'info',
          message: `Test "${test['name'] ?? `index ${i}`}" has no "expect" block.`,
        });
      }
    }
  }

  // Check description
  if (!parsed['description']) {
    warnings.push({
      file: relPath,
      rule: 'no-description',
      severity: 'info',
      message: 'Missing "description" field. Add one for documentation.',
    });
  }

  return warnings;
}

/**
 * Lint all prompt specs in a path.
 */
async function promptLinter(targetPath: string): Promise<LintWarning[]> {
  let files: string[];

  if (await fileExists(targetPath)) {
    files = [targetPath];
  } else if (await isDirectory(targetPath)) {
    files = await findSpecFiles(targetPath);
  } else {
    throw new Error(`Path not found: ${targetPath}`);
  }

  const allWarnings: LintWarning[] = [];
  for (const file of files) {
    const warnings = await lintFile(file, process.cwd());
    allWarnings.push(...warnings);
  }

  return allWarnings;
}

export function registerLintCommand(program: Command): void {
  program
    .command('lint [path]')
    .description('Lint prompt spec files for common issues and best practices')
    .option('--json', 'Output warnings as JSON')
    .option('--fix', 'Show fix suggestions (future)')
    .action(async (
      pathArg: string | undefined,
      options: { json?: boolean; fix?: boolean },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? 'prompts');

      const warnings = await promptLinter(targetPath);

      if (options.json) {
        console.log(JSON.stringify(warnings, null, 2));
        return;
      }

      if (warnings.length === 0) {
        console.log(chalk.green('\nNo lint issues found.\n'));
        return;
      }

      // Group by file
      const grouped = new Map<string, LintWarning[]>();
      for (const w of warnings) {
        const list = grouped.get(w.file) ?? [];
        list.push(w);
        grouped.set(w.file, list);
      }

      const severityIcon = (s: LintWarning['severity']): string => {
        switch (s) {
          case 'error': return chalk.red('ERR');
          case 'warning': return chalk.yellow('WRN');
          case 'info': return chalk.blue('INF');
        }
      };

      console.log(chalk.bold(`\nLint Results (${warnings.length} issues)`));
      console.log('');

      for (const [file, fileWarnings] of grouped) {
        console.log(chalk.bold(`  ${file}`));
        for (const w of fileWarnings) {
          const lineStr = w.line ? `:${w.line}` : '';
          console.log(`    ${severityIcon(w.severity)}  ${w.rule}${lineStr}: ${w.message}`);
        }
        console.log('');
      }

      const errorCount = warnings.filter((w) => w.severity === 'error').length;
      const warnCount = warnings.filter((w) => w.severity === 'warning').length;
      const infoCount = warnings.filter((w) => w.severity === 'info').length;

      console.log(
        chalk.dim(`  ${errorCount} errors, ${warnCount} warnings, ${infoCount} info\n`),
      );

      if (errorCount > 0) {
        process.exitCode = 1;
      }
    });
}
