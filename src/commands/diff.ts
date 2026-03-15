/**
 * `claude-test diff <a> <b>` — Compare two prompt spec files.
 */

import { Command } from 'commander';
import { readTextFile, fileExists } from '../utils/fs.js';
import { resolvePath } from '../utils/paths.js';
import { setLogLevel } from '../utils/logger.js';
import type { PromptSpec } from '../types/prompt.js';

interface DiffField {
  name: string;
  changed: boolean;
  valueA: string;
  valueB: string;
}

/**
 * Parse a YAML file into a PromptSpec.
 */
async function parseSpec(filePath: string): Promise<PromptSpec> {
  const yaml = (await import('js-yaml')).default;
  const content = await readTextFile(filePath);
  if (!content) {
    throw new Error(`Could not read prompt spec: ${filePath}`);
  }
  const parsed = yaml.load(content) as Record<string, unknown>;
  return {
    name: (parsed['name'] as string) ?? 'unnamed',
    description: parsed['description'] as string | undefined,
    model: parsed['model'] as string | undefined,
    system: parsed['system'] as string | undefined,
    prompt: (parsed['prompt'] as string) ?? '',
    tests: parsed['tests'] as PromptSpec['tests'],
  };
}

/**
 * Compare two prompt specs and produce field-level diffs.
 */
function promptDiff(specA: PromptSpec, specB: PromptSpec): DiffField[] {
  const fields: DiffField[] = [];

  const compareField = (name: string, a: string | undefined, b: string | undefined): void => {
    const valA = a ?? '';
    const valB = b ?? '';
    fields.push({
      name,
      changed: valA !== valB,
      valueA: valA,
      valueB: valB,
    });
  };

  compareField('name', specA.name, specB.name);
  compareField('description', specA.description, specB.description);
  compareField('model', specA.model, specB.model);
  compareField('system', specA.system, specB.system);
  compareField('prompt', specA.prompt, specB.prompt);

  const testsA = JSON.stringify(specA.tests ?? [], null, 2);
  const testsB = JSON.stringify(specB.tests ?? [], null, 2);
  fields.push({
    name: 'tests',
    changed: testsA !== testsB,
    valueA: testsA,
    valueB: testsB,
  });

  return fields;
}

/**
 * Show a truncated value for display purposes.
 */
function truncate(value: string, maxLength: number = 120): string {
  const oneLine = value.replace(/\n/g, '\\n');
  if (oneLine.length <= maxLength) return oneLine;
  return oneLine.slice(0, maxLength - 3) + '...';
}

export function registerDiffCommand(program: Command): void {
  program
    .command('diff <a> <b>')
    .description('Compare two prompt spec files and show differences')
    .option('--json', 'Output diff as JSON')
    .action(async (
      a: string,
      b: string,
      options: { json?: boolean },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const pathA = resolvePath(a);
      const pathB = resolvePath(b);

      if (!(await fileExists(pathA))) {
        throw new Error(`File not found: ${pathA}`);
      }
      if (!(await fileExists(pathB))) {
        throw new Error(`File not found: ${pathB}`);
      }

      const specA = await parseSpec(pathA);
      const specB = await parseSpec(pathB);
      const diffs = promptDiff(specA, specB);

      if (options.json) {
        console.log(JSON.stringify({
          fileA: pathA,
          fileB: pathB,
          fields: diffs,
        }, null, 2));
        return;
      }

      console.log(chalk.bold('\nPrompt Diff'));
      console.log(chalk.dim(`  A: ${a}`));
      console.log(chalk.dim(`  B: ${b}`));
      console.log('');

      const changedCount = diffs.filter((d) => d.changed).length;

      for (const field of diffs) {
        if (field.changed) {
          console.log(chalk.yellow(`  ~ ${field.name}: changed`));
          console.log(chalk.red(`    - ${truncate(field.valueA)}`));
          console.log(chalk.green(`    + ${truncate(field.valueB)}`));
        } else {
          console.log(chalk.dim(`    ${field.name}: unchanged`));
        }
      }

      console.log('');
      if (changedCount === 0) {
        console.log(chalk.green('  Specs are identical.'));
      } else {
        console.log(chalk.yellow(`  ${changedCount} field(s) changed.`));
      }
    });
}
