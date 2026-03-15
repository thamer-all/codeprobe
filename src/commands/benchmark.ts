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

    // Rough cost estimation (mock) — blended input+output rate per MTok
    const costPerMToken = model.includes('opus') ? 45.0 : 9.0;
    const estimatedCost = (averageTokens / 1_000_000) * costPerMToken * runs;

    return {
      model,
      promptName: spec.name,
      runs: benchmarkRuns,
      averageScore,
      averageTokens,
      averageLatency,
      estimatedCost,
    };
  });
}

export function registerBenchmarkCommand(program: Command): void {
  program
    .command('benchmark [path]')
    .description('Benchmark a prompt spec across multiple models (mock mode)')
    .option('--json', 'Output results as JSON')
    .option('--models <models>', 'Comma-separated list of models')
    .option('--runs <n>', 'Number of runs per model', '3')
    .action(async (
      pathArg: string | undefined,
      options: { json?: boolean; models?: string; runs: string },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? 'prompts');
      const runs = parseInt(options.runs, 10) || 3;
      const models = options.models
        ? options.models.split(',').map((m) => m.trim())
        : DEFAULT_MODELS;

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

      const rows = results.map((r) => [
        r.model,
        `${(r.averageScore * 100).toFixed(1)}%`,
        Math.round(r.averageTokens).toString(),
        formatDuration(r.averageLatency),
        `$${r.estimatedCost.toFixed(6)}`,
      ]);

      const table = formatTable(
        ['Model', 'Avg Score', 'Avg Tokens', 'Avg Latency', 'Est. Cost'],
        rows,
      );

      for (const line of table.split('\n')) {
        console.log(`  ${line}`);
      }

      console.log('');
    });
}
