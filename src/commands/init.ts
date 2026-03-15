/**
 * `claude-test init` — Create starter folders, example prompt files,
 * dataset examples, and configuration.
 */

import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolvePath } from '../utils/paths.js';
import { fileExists, isDirectory } from '../utils/fs.js';

const EXAMPLE_PROMPT_SPEC = `# Example prompt spec for claude-test
name: summarize
description: Summarize an article into bullet points
model: claude-sonnet-4-6

system: |
  You are a concise summarizer. Given an article, produce 3-5 bullet points
  capturing the key ideas.

prompt: |
  Summarize the following article into 3-5 bullet points:

  {{input}}

tests:
  - name: produces bullet points
    input: >
      Artificial intelligence is transforming industries worldwide.
      Healthcare, finance, and transportation are seeing significant
      improvements through machine learning applications.
    expect:
      contains:
        - "artificial intelligence"
      regex:
        - "^[\\\\s]*[-*]"
  - name: handles short input
    input: "The sky is blue."
    expect:
      contains:
        - "sky"
`;

const EXAMPLE_DATASET = `{"input":"Machine learning models require large amounts of data for training.","expected":"Summary mentioning data requirements"}
{"input":"Climate change is affecting weather patterns globally, leading to more extreme events.","expected":"Summary mentioning climate and weather"}
{"input":"Remote work has become the new norm since the pandemic reshaped how companies operate.","expected":"Summary mentioning remote work trends"}
`;

const EXAMPLE_FIXTURE = `The Rise of Context Engineering

Context engineering is the emerging discipline of designing and optimizing
the information provided to large language models (LLMs) to achieve better
outputs. Unlike prompt engineering, which focuses narrowly on the instruction
text, context engineering considers the entire input window: system prompts,
few-shot examples, retrieved documents, tool definitions, and conversation
history.

Key principles of context engineering include:

1. Token budget management — understanding how to allocate the finite
   context window across different information types.

2. Information density — ensuring every token carries maximum signal
   and minimal noise.

3. Structured formatting — using consistent formats (YAML, XML, markdown)
   that models parse reliably.

4. Progressive disclosure — loading information on demand rather than
   stuffing everything upfront.

5. Validation loops — testing that context changes actually improve
   model behavior on representative tasks.

As context windows grow from 8K to 200K to 1M+ tokens, context engineering
becomes increasingly important. The challenge shifts from "what fits" to
"what matters" — curating the right information at the right level of
detail for each specific task.
`;

const EXAMPLE_CONFIG = `# claude-test configuration
# See: https://github.com/anthropics/claude-test

defaultModel: claude-sonnet-4-6
defaultContextTarget: 200k

# Paths to ignore during context analysis
ignorePaths:
  - node_modules
  - .git
  - dist
  - coverage
  - "*.min.js"
  - "*.map"

# Enable result caching
caching: true

# Context window budget allocation (percentages)
contextBudgets:
  systemPrompt: 10
  coreFiles: 50
  docs: 20
  toolMeta: 10

# Watch mode settings
watchDefaults:
  debounceMs: 300
  clearScreen: true

# Benchmark defaults
benchmarkDefaults:
  models:
    - claude-sonnet-4-6
    - claude-opus-4-6
  runs: 3
  warmup: true
`;

interface InitItem {
  type: 'dir' | 'file';
  path: string;
  content?: string;
  description: string;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Create starter folders, example prompt files, dataset examples, and config')
    .option('--force', 'Overwrite existing files')
    .action(async (options: { force?: boolean }) => {
      const chalk = (await import('chalk')).default;
      const root = process.cwd();

      const items: InitItem[] = [
        {
          type: 'dir',
          path: 'prompts',
          description: 'Prompt specs directory',
        },
        {
          type: 'file',
          path: join('prompts', 'summarize.prompt.yaml'),
          content: EXAMPLE_PROMPT_SPEC,
          description: 'Example prompt spec',
        },
        {
          type: 'dir',
          path: 'datasets',
          description: 'Datasets directory',
        },
        {
          type: 'file',
          path: join('datasets', 'sample.jsonl'),
          content: EXAMPLE_DATASET,
          description: 'Example dataset',
        },
        {
          type: 'dir',
          path: 'fixtures',
          description: 'Test fixtures directory',
        },
        {
          type: 'file',
          path: join('fixtures', 'article.txt'),
          content: EXAMPLE_FIXTURE,
          description: 'Sample fixture',
        },
        {
          type: 'dir',
          path: 'examples',
          description: 'Examples directory',
        },
        {
          type: 'file',
          path: 'claude-test.config.yaml',
          content: EXAMPLE_CONFIG,
          description: 'Configuration file',
        },
      ];

      let created = 0;
      let skipped = 0;

      for (const item of items) {
        const fullPath = resolvePath(join(root, item.path));

        if (item.type === 'dir') {
          if (await isDirectory(fullPath)) {
            if (!options.force) {
              console.log(chalk.dim(`  skip  ${item.path}/ (already exists)`));
              skipped++;
              continue;
            }
          }
          await mkdir(fullPath, { recursive: true });
          console.log(chalk.green(`  create  ${item.path}/`));
          created++;
        } else {
          if ((await fileExists(fullPath)) && !options.force) {
            console.log(chalk.dim(`  skip  ${item.path} (already exists)`));
            skipped++;
            continue;
          }
          // Ensure parent directory exists
          const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
          await mkdir(parentDir, { recursive: true });
          await writeFile(fullPath, item.content ?? '', 'utf-8');
          console.log(chalk.green(`  create  ${item.path}`));
          created++;
        }
      }

      console.log('');
      console.log(
        chalk.bold(`Initialized claude-test project: ${created} created, ${skipped} skipped`),
      );
      console.log('');
      console.log(chalk.dim('Next steps:'));
      console.log(chalk.dim('  1. Edit prompts/summarize.prompt.yaml with your prompt'));
      console.log(chalk.dim('  2. Run: claude-test test'));
      console.log(chalk.dim('  3. Run: claude-test context'));
    });
}
