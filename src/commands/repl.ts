/**
 * `claude-test repl` — Interactive prompt playground.
 *
 * Provides a REPL interface for loading prompt specs, setting models,
 * and running prompts interactively in mock mode.
 */

import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { resolvePath } from '../utils/paths.js';
import { readTextFile, fileExists } from '../utils/fs.js';
import type { PromptSpec } from '../types/prompt.js';

interface ReplState {
  spec: PromptSpec | null;
  model: string;
  systemPrompt: string;
  lastOutput: string;
}

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
 * Execute a prompt in mock mode.
 */
function mockExecute(state: ReplState, input: string): string {
  const prompt = state.spec?.prompt ?? '{{input}}';
  const rendered = prompt.replace(/\{\{input\}\}/g, input);

  return (
    `[Mock Response]\n` +
    `Model: ${state.model}\n` +
    `System: ${state.systemPrompt ? state.systemPrompt.slice(0, 60) + '...' : '(none)'}\n` +
    `Prompt: ${rendered.slice(0, 100)}${rendered.length > 100 ? '...' : ''}\n` +
    `\n` +
    `This is a simulated response for the input: "${input}"\n` +
    `In live mode, this would call the ${state.model} API.`
  );
}

function printHelp(): void {
  console.log(`
Commands:
  .load <path>      Load a prompt spec file
  .model <model>    Set the model
  .system <text>    Set the system prompt
  .last             Show last output
  .state            Show current state
  .clear            Clear state
  .help             Show this help
  .exit             Exit REPL

Usage:
  Type any text and press Enter to run it as input.
  The loaded prompt spec (if any) will be used as the template.
`);
}

export function registerReplCommand(program: Command): void {
  program
    .command('repl')
    .description('Interactive prompt playground — load specs, set models, run prompts')
    .action(async () => {
      const chalk = (await import('chalk')).default;

      const state: ReplState = {
        spec: null,
        model: 'claude-sonnet-4-6',
        systemPrompt: '',
        lastOutput: '',
      };

      console.log(chalk.bold('\nclaude-test REPL'));
      console.log(chalk.dim('Type .help for commands, or enter text to run a prompt.'));
      console.log(chalk.dim('Press Ctrl+C or type .exit to quit.\n'));

      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.cyan('claude-test> '),
        terminal: true,
      });

      rl.prompt();

      rl.on('line', async (line: string) => {
        const trimmed = line.trim();

        if (!trimmed) {
          rl.prompt();
          return;
        }

        try {
          if (trimmed === '.exit' || trimmed === '.quit') {
            console.log(chalk.dim('Goodbye.'));
            rl.close();
            return;
          }

          if (trimmed === '.help') {
            printHelp();
            rl.prompt();
            return;
          }

          if (trimmed === '.last') {
            if (state.lastOutput) {
              console.log(state.lastOutput);
            } else {
              console.log(chalk.dim('No previous output.'));
            }
            rl.prompt();
            return;
          }

          if (trimmed === '.state') {
            console.log(chalk.bold('  Current State:'));
            console.log(`    Model:  ${state.model}`);
            console.log(`    System: ${state.systemPrompt ? state.systemPrompt.slice(0, 60) + '...' : '(none)'}`);
            console.log(`    Spec:   ${state.spec ? state.spec.name : '(none loaded)'}`);
            rl.prompt();
            return;
          }

          if (trimmed === '.clear') {
            state.spec = null;
            state.systemPrompt = '';
            state.lastOutput = '';
            console.log(chalk.dim('State cleared.'));
            rl.prompt();
            return;
          }

          if (trimmed.startsWith('.load ')) {
            const path = resolvePath(trimmed.slice(6).trim());
            if (!(await fileExists(path))) {
              console.log(chalk.red(`File not found: ${path}`));
              rl.prompt();
              return;
            }
            state.spec = await parseSpec(path);
            if (state.spec.model) {
              state.model = state.spec.model;
            }
            if (state.spec.system) {
              state.systemPrompt = state.spec.system;
            }
            console.log(chalk.green(`Loaded: ${state.spec.name}`));
            if (state.spec.description) {
              console.log(chalk.dim(`  ${state.spec.description}`));
            }
            rl.prompt();
            return;
          }

          if (trimmed.startsWith('.model ')) {
            state.model = trimmed.slice(7).trim();
            console.log(chalk.green(`Model set: ${state.model}`));
            rl.prompt();
            return;
          }

          if (trimmed.startsWith('.system ')) {
            state.systemPrompt = trimmed.slice(8).trim();
            console.log(chalk.green('System prompt set.'));
            rl.prompt();
            return;
          }

          if (trimmed.startsWith('.')) {
            console.log(chalk.red(`Unknown command: ${trimmed.split(' ')[0]}`));
            console.log(chalk.dim('Type .help for available commands.'));
            rl.prompt();
            return;
          }

          // Execute the input as a prompt
          const output = mockExecute(state, trimmed);
          state.lastOutput = output;
          console.log('');
          console.log(chalk.dim('---'));
          console.log(output);
          console.log(chalk.dim('---'));
          console.log('');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.log(chalk.red(`Error: ${message}`));
        }

        rl.prompt();
      });

      rl.on('close', () => {
        process.exit(0);
      });

      // Keep the process alive
      await new Promise<never>(() => {
        // Intentionally never resolves — REPL runs until user exits
      });
    });
}
