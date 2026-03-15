/**
 * `claude-test explain <prompt-file>` — Explain a prompt spec in
 * human-readable form, breaking down its structure and purpose.
 */

import { Command } from 'commander';
import { resolvePath } from '../utils/paths.js';
import { readTextFile, fileExists } from '../utils/fs.js';
import { setLogLevel } from '../utils/logger.js';
import { estimateTokens } from '../tokenizers/claudeTokenizer.js';
import { formatTokens } from '../utils/output.js';
import type { PromptSpec } from '../types/prompt.js';

/**
 * Parse a YAML prompt spec.
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

interface PromptExplanation {
  name: string;
  description: string | undefined;
  model: string | undefined;
  hasSystem: boolean;
  systemTokens: number;
  systemSummary: string;
  promptTokens: number;
  promptSummary: string;
  totalTokens: number;
  templateVariables: string[];
  testCount: number;
  testNames: string[];
  assertionTypes: string[];
}

/**
 * Generate an explanation of a prompt spec.
 */
function promptExplainer(spec: PromptSpec): PromptExplanation {
  const systemText = spec.system ?? '';
  const promptText = spec.prompt;

  const systemTokens = estimateTokens(systemText);
  const promptTokens = estimateTokens(promptText);

  // Extract template variables
  const varPattern = /\{\{(\w+)\}\}/g;
  const variables = new Set<string>();
  let match: RegExpExecArray | null;
  match = varPattern.exec(promptText);
  while (match) {
    variables.add(match[1]!);
    match = varPattern.exec(promptText);
  }

  // Summarize system prompt
  let systemSummary = '(none)';
  if (systemText) {
    const firstLine = systemText.split('\n')[0]?.trim() ?? '';
    systemSummary = firstLine.length > 80
      ? firstLine.slice(0, 77) + '...'
      : firstLine;
  }

  // Summarize prompt
  const promptFirstLine = promptText.split('\n')[0]?.trim() ?? '';
  const promptSummary = promptFirstLine.length > 80
    ? promptFirstLine.slice(0, 77) + '...'
    : promptFirstLine;

  // Test details
  const tests = spec.tests ?? [];
  const testNames = tests.map((t) => t.name);
  const assertionTypes = new Set<string>();
  for (const test of tests) {
    if (test.expect?.contains) assertionTypes.add('contains');
    if (test.expect?.notContains) assertionTypes.add('notContains');
    if (test.expect?.regex) assertionTypes.add('regex');
    if (test.expect?.equals) assertionTypes.add('equals');
    if (test.expect?.jsonSchema) assertionTypes.add('jsonSchema');
  }

  return {
    name: spec.name,
    description: spec.description,
    model: spec.model,
    hasSystem: !!spec.system,
    systemTokens,
    systemSummary,
    promptTokens,
    promptSummary,
    totalTokens: systemTokens + promptTokens,
    templateVariables: Array.from(variables),
    testCount: tests.length,
    testNames,
    assertionTypes: Array.from(assertionTypes),
  };
}

export function registerExplainCommand(program: Command): void {
  program
    .command('explain <prompt-file>')
    .description('Explain a prompt spec — structure, tokens, variables, and tests')
    .option('--json', 'Output explanation as JSON')
    .action(async (
      promptFile: string,
      options: { json?: boolean },
    ) => {
      const chalk = (await import('chalk')).default;
      const filePath = resolvePath(promptFile);

      if (!(await fileExists(filePath))) {
        throw new Error(`File not found: ${filePath}`);
      }

      const spec = await parseSpec(filePath);
      const explanation = promptExplainer(spec);

      if (options.json) {
        console.log(JSON.stringify(explanation, null, 2));
        return;
      }

      console.log(chalk.bold(`\nPrompt Explanation: ${explanation.name}`));
      if (explanation.description) {
        console.log(chalk.dim(`  ${explanation.description}`));
      }
      console.log('');

      // Overview
      console.log(chalk.bold('  Overview'));
      console.log(`    Model:            ${explanation.model ?? chalk.dim('(default)')}`);
      console.log(`    Total tokens:     ${formatTokens(explanation.totalTokens)}`);
      console.log(`    System tokens:    ${formatTokens(explanation.systemTokens)}`);
      console.log(`    Prompt tokens:    ${formatTokens(explanation.promptTokens)}`);
      console.log('');

      // System prompt
      console.log(chalk.bold('  System Prompt'));
      if (explanation.hasSystem) {
        console.log(`    ${explanation.systemSummary}`);
      } else {
        console.log(chalk.dim('    No system prompt defined.'));
      }
      console.log('');

      // Prompt
      console.log(chalk.bold('  Prompt'));
      console.log(`    ${explanation.promptSummary}`);
      console.log('');

      // Template variables
      console.log(chalk.bold('  Template Variables'));
      if (explanation.templateVariables.length > 0) {
        for (const v of explanation.templateVariables) {
          console.log(`    {{${v}}}`);
        }
      } else {
        console.log(chalk.dim('    No template variables found.'));
      }
      console.log('');

      // Tests
      console.log(chalk.bold('  Tests'));
      if (explanation.testCount > 0) {
        console.log(`    Count: ${explanation.testCount}`);
        for (const name of explanation.testNames) {
          console.log(`    - ${name}`);
        }
        if (explanation.assertionTypes.length > 0) {
          console.log(`    Assertion types: ${explanation.assertionTypes.join(', ')}`);
        }
      } else {
        console.log(chalk.dim('    No tests defined.'));
      }

      console.log('');
    });
}
