/**
 * `claude-test benchmark [path]` — Benchmark a prompt across models.
 */

import { Command } from 'commander';
import { resolvePath } from '../utils/paths.js';
import { readTextFile, fileExists, isDirectory } from '../utils/fs.js';
import { formatDuration, formatTable } from '../utils/output.js';
import { setLogLevel } from '../utils/logger.js';
import type { PromptSpec } from '../types/prompt.js';
import type { BenchmarkResult, BenchmarkRun } from '../types/results.js';
import {
  getModel,
  getAllModels,
  getModelsByProvider,
  getProviders,
  estimateCost,
} from '../core/modelRegistry.js';

const DEFAULT_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6'];

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
 * Find the first prompt spec file in a directory.
 */
async function findFirstSpec(dirPath: string): Promise<string | null> {
  const { glob } = await import('glob');
  const files = await glob('**/*.prompt.{yaml,yml}', {
    cwd: dirPath,
    absolute: true,
  });
  return files[0] ?? null;
}

/**
 * Run benchmark in mock mode — simulates model responses.
 * Uses the model registry for cost estimation.
 */
function benchmarkRunner(
  spec: PromptSpec,
  models: string[],
  runs: number,
): BenchmarkResult[] {
  return models.map((model) => {
    const benchmarkRuns: BenchmarkRun[] = [];

    for (let i = 0; i < runs; i++) {
      // Simulate varying latency and token counts
      const baseLatency = model.includes('opus') ? 1500 : 500;
      const latency = baseLatency + Math.floor(Math.random() * 200);
      const tokens = 150 + Math.floor(Math.random() * 100);
      const score = model.includes('opus')
        ? 0.85 + Math.random() * 0.13
        : 0.7 + Math.random() * 0.3;

      benchmarkRuns.push({
        runIndex: i,
        score,
        tokens,
        latency,
        output: `[Mock ${model} run ${i + 1}] Response for "${spec.name}"`,
      });
    }

    const averageScore = benchmarkRuns.reduce((s, r) => s + r.score, 0) / runs;
    const averageTokens = benchmarkRuns.reduce((s, r) => s + r.tokens, 0) / runs;
    const averageLatency = benchmarkRuns.reduce((s, r) => s + r.latency, 0) / runs;

    // Cost estimation via model registry.  Falls back to a blended heuristic
    // for models not yet in the registry (backward compat).
    const modelInfo = getModel(model);
    let totalEstimatedCost: number;
    if (modelInfo) {
      totalEstimatedCost = benchmarkRuns.reduce((sum, r) => {
        // Rough split: 60 % input, 40 % output
        const inputTokens = Math.round(r.tokens * 0.6);
        const outputTokens = r.tokens - inputTokens;
        return sum + estimateCost(model, inputTokens, outputTokens);
      }, 0);
    } else {
      // Legacy fallback for unknown models
      const costPerMToken = model.includes('opus') ? 45.0 : 9.0;
      totalEstimatedCost = (averageTokens / 1_000_000) * costPerMToken * runs;
    }

    return {
      model,
      promptName: spec.name,
      runs: benchmarkRuns,
      averageScore,
      averageTokens,
      averageLatency,
      estimatedCost: totalEstimatedCost,
    };
  });
}

/**
 * Format a number with thousands separators.
 */
function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Print the model registry table.
 */
async function printModelList(providerFilter?: string): Promise<void> {
  const chalk = (await import('chalk')).default;
  const models = providerFilter
    ? getModelsByProvider(providerFilter)
    : getAllModels();

  if (models.length === 0) {
    if (providerFilter) {
      console.log(chalk.yellow(`No models found for provider "${providerFilter}".`));
      console.log(`Available providers: ${getProviders().join(', ')}`);
    } else {
      console.log(chalk.yellow('No models registered.'));
    }
    return;
  }

  const title = providerFilter
    ? `Models (${providerFilter})`
    : `All Registered Models (${models.length})`;

  console.log(chalk.bold(`\n${title}\n`));

  const rows = models.map((m) => [
    m.id,
    m.provider,
    m.name,
    formatNumber(m.contextWindow),
    formatNumber(m.maxOutput),
    `$${m.inputPricePer1M.toFixed(2)}`,
    `$${m.outputPricePer1M.toFixed(2)}`,
  ]);

  const table = formatTable(
    ['ID', 'Provider', 'Name', 'Context', 'Max Output', 'Input $/1M', 'Output $/1M'],
    rows,
  );

  for (const line of table.split('\n')) {
    console.log(`  ${line}`);
  }

  console.log('');
  console.log(chalk.dim(`  Providers: ${getProviders().join(', ')}`));
  console.log('');
}

export function registerBenchmarkCommand(program: Command): void {
  program
    .command('benchmark [path]')
    .description('Benchmark a prompt spec across multiple models (mock mode)')
    .option('--json', 'Output results as JSON')
    .option('--models <models>', 'Comma-separated list of models')
    .option('--provider <provider>', 'Filter models by provider (e.g. openai, google)')
    .option('--runs <n>', 'Number of runs per model', '3')
    .option('--list-models', 'List all available models and exit')
    .action(async (
      pathArg: string | undefined,
      options: {
        json?: boolean;
        models?: string;
        provider?: string;
        runs: string;
        listModels?: boolean;
      },
    ) => {
      // --list-models: print model registry and exit
      if (options.listModels) {
        await printModelList(options.provider);
        return;
      }

      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? 'prompts');
      const runs = parseInt(options.runs, 10) || 3;

      // Determine which models to benchmark
      let models: string[];
      if (options.models) {
        models = options.models.split(',').map((m) => m.trim());
      } else if (options.provider) {
        const providerModels = getModelsByProvider(options.provider);
        if (providerModels.length === 0) {
          console.error(
            chalk.red(`No models found for provider "${options.provider}".`),
          );
          console.error(`Available providers: ${getProviders().join(', ')}`);
          process.exitCode = 1;
          return;
        }
        models = providerModels.map((m) => m.id);
      } else {
        models = DEFAULT_MODELS;
      }

      let specPath: string;

      if (await fileExists(targetPath)) {
        specPath = targetPath;
      } else if (await isDirectory(targetPath)) {
        const found = await findFirstSpec(targetPath);
        if (!found) {
          throw new Error(`No prompt spec files found in ${targetPath}`);
        }
        specPath = found;
      } else {
        throw new Error(`Path not found: ${targetPath}`);
      }

      const spec = await parseSpec(specPath);
      const results = benchmarkRunner(spec, models, runs);

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      console.log(chalk.bold(`\nBenchmark: ${spec.name}`));
      console.log(chalk.dim(`  Runs per model: ${runs}`));
      console.log('');

      const tableRows = results.map((r) => [
        r.model,
        `${(r.averageScore * 100).toFixed(1)}%`,
        Math.round(r.averageTokens).toString(),
        formatDuration(r.averageLatency),
        `$${r.estimatedCost.toFixed(6)}`,
      ]);

      const table = formatTable(
        ['Model', 'Avg Score', 'Avg Tokens', 'Avg Latency', 'Est. Cost'],
        tableRows,
      );

      for (const line of table.split('\n')) {
        console.log(`  ${line}`);
      }

      console.log('');
    });
}
