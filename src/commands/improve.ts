/**
 * `claude-test improve <prompt-file>` — Suggest improvements for a
 * prompt spec.
 */

import { Command } from 'commander';
import { resolvePath } from '../utils/paths.js';
import { readTextFile, fileExists } from '../utils/fs.js';
import { setLogLevel } from '../utils/logger.js';
import type { PromptSpec } from '../types/prompt.js';
import type { ImprovementSuggestion } from '../types/diagnostics.js';

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

/**
 * Analyze a prompt spec and generate improvement suggestions.
 */
function promptImprover(spec: PromptSpec): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = [];

  // System prompt analysis
  if (!spec.system) {
    suggestions.push({
      category: 'Structure',
      priority: 'high',
      message: 'Add a system prompt to set the model persona and constraints.',
      details: 'System prompts help establish consistent behavior. Define who the model is, ' +
        'what it should and should not do, and the output format.',
    });
  } else {
    if (spec.system.length < 50) {
      suggestions.push({
        category: 'Structure',
        priority: 'medium',
        message: 'System prompt is very brief. Consider adding more constraints.',
        details: 'A well-defined system prompt typically includes: persona, task scope, ' +
          'output format, edge case handling, and tone guidelines.',
      });
    }

    if (!/\b(format|output|respond|return)\b/i.test(spec.system)) {
      suggestions.push({
        category: 'Output Control',
        priority: 'medium',
        message: 'System prompt does not specify output format.',
        details: 'Define expected output format (JSON, markdown, bullet points, etc.) ' +
          'for more predictable results.',
      });
    }
  }

  // Prompt analysis
  const prompt = spec.prompt;
  if (prompt.length < 20) {
    suggestions.push({
      category: 'Clarity',
      priority: 'high',
      message: 'Prompt is very short. Add more detail about the expected task.',
    });
  }

  if (!/\{\{.*?\}\}/.test(prompt) && !/\$\{.*?\}/.test(prompt)) {
    suggestions.push({
      category: 'Templating',
      priority: 'medium',
      message: 'No template variables found ({{variable}}).',
      details: 'Use template variables like {{input}} to make the prompt reusable ' +
        'across different inputs and test cases.',
    });
  }

  if (!/\b(example|e\.g\.|for instance|such as)\b/i.test(prompt) &&
      !/\b(input|output):/im.test(prompt)) {
    suggestions.push({
      category: 'Few-shot',
      priority: 'medium',
      message: 'Consider adding examples (few-shot) to the prompt.',
      details: 'Including 1-3 input/output examples significantly improves consistency.',
    });
  }

  if (!/\b(do not|don\'t|never|avoid|must not)\b/i.test(prompt) &&
      !/\b(do not|don\'t|never|avoid|must not)\b/i.test(spec.system ?? '')) {
    suggestions.push({
      category: 'Guardrails',
      priority: 'low',
      message: 'Consider adding negative constraints (what the model should NOT do).',
      details: 'Explicit negative instructions help prevent common failure modes.',
    });
  }

  // Test analysis
  const tests = spec.tests ?? [];
  if (tests.length === 0) {
    suggestions.push({
      category: 'Testing',
      priority: 'high',
      message: 'No tests defined. Add at least 2-3 test cases.',
      details: 'Tests should cover: happy path, edge cases, and adversarial inputs.',
    });
  } else if (tests.length < 3) {
    suggestions.push({
      category: 'Testing',
      priority: 'medium',
      message: `Only ${tests.length} test(s) defined. Consider adding more for better coverage.`,
      details: 'Aim for at least 3 tests: basic functionality, edge case, and error handling.',
    });
  }

  const hasNegativeTest = tests.some((t) => t.expect?.notContains && t.expect.notContains.length > 0);
  if (!hasNegativeTest && tests.length > 0) {
    suggestions.push({
      category: 'Testing',
      priority: 'low',
      message: 'No negative test assertions (notContains). Consider testing what output should NOT include.',
    });
  }

  // Model analysis
  if (!spec.model) {
    suggestions.push({
      category: 'Configuration',
      priority: 'low',
      message: 'No model specified. Will use config default.',
      details: 'Specifying the model ensures reproducible results across environments.',
    });
  }

  // Description analysis
  if (!spec.description) {
    suggestions.push({
      category: 'Documentation',
      priority: 'low',
      message: 'Add a description field for documentation and discoverability.',
    });
  }

  return suggestions;
}

export function registerImproveCommand(program: Command): void {
  program
    .command('improve <prompt-file>')
    .description('Suggest improvements for a prompt spec file')
    .option('--json', 'Output suggestions as JSON')
    .action(async (
      promptFile: string,
      options: { json?: boolean },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const filePath = resolvePath(promptFile);

      if (!(await fileExists(filePath))) {
        throw new Error(`File not found: ${filePath}`);
      }

      const spec = await parseSpec(filePath);
      const suggestions = promptImprover(spec);

      if (options.json) {
        console.log(JSON.stringify({ file: promptFile, suggestions }, null, 2));
        return;
      }

      if (suggestions.length === 0) {
        console.log(chalk.green(`\nNo improvements suggested for "${spec.name}". Looks good!\n`));
        return;
      }

      console.log(chalk.bold(`\nImprovement Suggestions for "${spec.name}"`));
      console.log(chalk.dim(`  File: ${promptFile}`));
      console.log(`  ${suggestions.length} suggestion(s)\n`);

      // Group by priority
      const priorityOrder: ImprovementSuggestion['priority'][] = ['high', 'medium', 'low'];
      const priorityColors: Record<ImprovementSuggestion['priority'], (s: string) => string> = {
        high: chalk.red,
        medium: chalk.yellow,
        low: chalk.blue,
      };

      for (const priority of priorityOrder) {
        const items = suggestions.filter((s) => s.priority === priority);
        if (items.length === 0) continue;

        console.log(chalk.bold(`  ${priorityColors[priority](priority.toUpperCase())} priority`));
        for (const item of items) {
          console.log(`    [${item.category}] ${item.message}`);
          if (item.details) {
            console.log(chalk.dim(`      ${item.details}`));
          }
        }
        console.log('');
      }
    });
}
