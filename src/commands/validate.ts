/**
 * `claude-test validate [path]` — Validate prompt specs, skill files,
 * and Claude configuration files for structural correctness.
 */

import { Command } from 'commander';
import { resolve } from 'node:path';
import { resolvePath } from '../utils/paths.js';
import { readTextFile, isDirectory, fileExists, getRelativePath as getRelPath } from '../utils/fs.js';
import { setLogLevel } from '../utils/logger.js';

interface ValidationResult {
  file: string;
  type: 'prompt-spec' | 'skill' | 'config' | 'unknown';
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a YAML prompt spec structure.
 */
async function validatePromptSpec(
  filePath: string,
  rootPath: string,
): Promise<ValidationResult> {
  const yaml = (await import('js-yaml')).default;
  const relPath = getRelPath(rootPath, filePath);
  const errors: string[] = [];
  const warnings: string[] = [];

  const content = await readTextFile(filePath);
  if (!content) {
    return { file: relPath, type: 'prompt-spec', valid: false, errors: ['Could not read file'], warnings };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { file: relPath, type: 'prompt-spec', valid: false, errors: [`Invalid YAML: ${msg}`], warnings };
  }

  if (!parsed || typeof parsed !== 'object') {
    errors.push('YAML content is not an object');
    return { file: relPath, type: 'prompt-spec', valid: false, errors, warnings };
  }

  const spec = parsed as Record<string, unknown>;

  // Required fields
  if (typeof spec['prompt'] !== 'string') {
    errors.push('Missing or invalid "prompt" field (must be a string)');
  }

  // Recommended fields
  if (typeof spec['name'] !== 'string') {
    warnings.push('Missing "name" field');
  }

  // Validate model field type
  if (spec['model'] !== undefined && typeof spec['model'] !== 'string') {
    errors.push('"model" field must be a string');
  }

  // Validate system field type
  if (spec['system'] !== undefined && typeof spec['system'] !== 'string') {
    errors.push('"system" field must be a string');
  }

  // Validate tests array
  if (spec['tests'] !== undefined) {
    if (!Array.isArray(spec['tests'])) {
      errors.push('"tests" field must be an array');
    } else {
      for (let i = 0; i < spec['tests'].length; i++) {
        const test = spec['tests'][i] as Record<string, unknown> | undefined;
        if (!test || typeof test !== 'object') {
          errors.push(`Test at index ${i} is not an object`);
          continue;
        }
        if (typeof test['name'] !== 'string') {
          warnings.push(`Test at index ${i} is missing a "name" field`);
        }
        if (test['expect'] !== undefined && typeof test['expect'] !== 'object') {
          errors.push(`Test "${test['name'] ?? i}" has invalid "expect" (must be an object)`);
        }
      }
    }
  }

  return {
    file: relPath,
    type: 'prompt-spec',
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a skill file (YAML with frontmatter or markdown with frontmatter).
 */
async function validateSkillFile(
  filePath: string,
  rootPath: string,
): Promise<ValidationResult> {
  const relPath = getRelPath(rootPath, filePath);
  const errors: string[] = [];
  const warnings: string[] = [];

  const content = await readTextFile(filePath);
  if (!content) {
    return { file: relPath, type: 'skill', valid: false, errors: ['Could not read file'], warnings };
  }

  // Check for frontmatter delimiter
  if (!content.startsWith('---')) {
    warnings.push('Skill file should start with YAML frontmatter (---)');
  } else {
    const endIdx = content.indexOf('---', 3);
    if (endIdx === -1) {
      errors.push('Frontmatter not closed (missing closing ---)');
    } else {
      const frontmatter = content.slice(3, endIdx).trim();
      if (frontmatter.length === 0) {
        warnings.push('Frontmatter is empty');
      } else {
        try {
          const yaml = (await import('js-yaml')).default;
          const parsed = yaml.load(frontmatter) as Record<string, unknown>;
          if (typeof parsed !== 'object' || parsed === null) {
            errors.push('Frontmatter did not parse to an object');
          } else {
            if (!parsed['name']) {
              warnings.push('Skill frontmatter missing "name" field');
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Invalid frontmatter YAML: ${msg}`);
        }
      }
    }
  }

  return {
    file: relPath,
    type: 'skill',
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a config file.
 */
async function validateConfigFile(
  filePath: string,
  rootPath: string,
): Promise<ValidationResult> {
  const relPath = getRelPath(rootPath, filePath);
  const errors: string[] = [];
  const warnings: string[] = [];

  const content = await readTextFile(filePath);
  if (!content) {
    return { file: relPath, type: 'config', valid: false, errors: ['Could not read file'], warnings };
  }

  try {
    if (filePath.endsWith('.json')) {
      JSON.parse(content);
    } else {
      const yaml = (await import('js-yaml')).default;
      const parsed = yaml.load(content);
      if (typeof parsed !== 'object' || parsed === null) {
        errors.push('Config file did not parse to an object');
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Parse error: ${msg}`);
  }

  return {
    file: relPath,
    type: 'config',
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function registerValidateCommand(program: Command): void {
  program
    .command('validate [path]')
    .description('Validate prompt specs, skill files, and Claude config files')
    .option('--json', 'Output validation results as JSON')
    .action(async (
      pathArg: string | undefined,
      options: { json?: boolean },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? '.');
      const { glob } = await import('glob');
      const results: ValidationResult[] = [];

      if (await fileExists(targetPath)) {
        // Single file
        if (targetPath.includes('.prompt.')) {
          results.push(await validatePromptSpec(targetPath, process.cwd()));
        } else if (targetPath.includes('.skill.')) {
          results.push(await validateSkillFile(targetPath, process.cwd()));
        } else {
          results.push(await validateConfigFile(targetPath, process.cwd()));
        }
      } else if (await isDirectory(targetPath)) {
        // Scan directory for all relevant files
        const promptSpecs = await glob(resolve(targetPath, '**/*.prompt.{yaml,yml}'), { absolute: true });
        for (const file of promptSpecs) {
          results.push(await validatePromptSpec(file, targetPath));
        }

        const skillFiles = await glob(resolve(targetPath, '**/*.skill.{yaml,yml,md}'), { absolute: true });
        for (const file of skillFiles) {
          results.push(await validateSkillFile(file, targetPath));
        }

        // Check for config files
        const configNames = [
          'claude-test.config.yaml',
          'claude-test.config.yml',
          'claude-test.config.json',
          '.claude-test.yaml',
          '.claude-test.json',
        ];
        for (const name of configNames) {
          const configPath = resolve(targetPath, name);
          if (await fileExists(configPath)) {
            results.push(await validateConfigFile(configPath, targetPath));
          }
        }
      } else {
        throw new Error(`Path not found: ${targetPath}`);
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(chalk.dim('\nNo files found to validate.\n'));
        return;
      }

      const validCount = results.filter((r) => r.valid).length;
      const invalidCount = results.filter((r) => !r.valid).length;
      const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);

      console.log(chalk.bold(`\nValidation Results (${results.length} files)`));
      console.log('');

      for (const result of results) {
        const icon = result.valid ? chalk.green('PASS') : chalk.red('FAIL');
        console.log(`  ${icon}  ${result.file}  ${chalk.dim(`(${result.type})`)}`);

        for (const err of result.errors) {
          console.log(chalk.red(`         error: ${err}`));
        }
        for (const warn of result.warnings) {
          console.log(chalk.yellow(`         warn:  ${warn}`));
        }
      }

      console.log('');
      console.log(
        chalk.bold('Summary: ') +
        chalk.green(`${validCount} valid`) + ', ' +
        (invalidCount > 0 ? chalk.red(`${invalidCount} invalid`) : `${invalidCount} invalid`) + ', ' +
        (totalWarnings > 0 ? chalk.yellow(`${totalWarnings} warnings`) : `${totalWarnings} warnings`),
      );
      console.log('');

      if (invalidCount > 0) {
        process.exitCode = 1;
      }
    });
}
