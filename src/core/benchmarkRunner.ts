/**
 * Benchmark runner for AI models.
 *
 * Runs a prompt spec against one or more models, collecting
 * score, token usage, latency, and cost data across multiple runs.
 * Supports a mock mode for offline development and CI pipelines.
 *
 * Pricing and model metadata are sourced from the central model registry.
 */

import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import type { PromptSpec } from '../types/prompt.js';
import type { BenchmarkResult, BenchmarkRun } from '../types/results.js';
import { getModel, estimateCost as registryEstimateCost } from './modelRegistry.js';

export interface BenchmarkOptions {
  models?: string[];
  runs?: number;
  mode?: 'mock' | 'live';
  verbose?: boolean;
}

/** Default models to benchmark when none are specified. */
const DEFAULT_MODELS: string[] = ['claude-sonnet-4-6', 'claude-opus-4-6'];

/** Default number of runs per model. */
const DEFAULT_RUNS = 3;

/**
 * Rough estimate of token count from a text string.
 * Uses a simple heuristic: ~4 characters per token for English text.
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Determine the model tier for mock score generation.
 * Higher-tier models produce higher simulated scores.
 */
function getModelTier(model: string): 'opus' | 'sonnet' | 'other' {
  if (model.includes('opus')) return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  return 'other';
}

/**
 * Generate a random value within a +-variance range of the base.
 */
function withVariance(base: number, varianceFraction: number): number {
  const delta = base * varianceFraction;
  return base + (Math.random() * 2 - 1) * delta;
}

/**
 * Generate a mock benchmark run for offline development.
 */
function generateMockRun(
  runIndex: number,
  spec: PromptSpec,
  model: string,
): BenchmarkRun {
  const tier = getModelTier(model);

  // Score: opus scores higher (0.85-0.98), sonnet (0.75-0.90), other (0.65-0.80)
  const baseScore =
    tier === 'opus' ? 0.92 : tier === 'sonnet' ? 0.83 : 0.72;
  const score = Math.min(1.0, Math.max(0, withVariance(baseScore, 0.05)));

  // Tokens: estimate from prompt + system text
  const promptTokens = estimateTokens(spec.prompt);
  const systemTokens = estimateTokens(spec.system ?? '');
  const inputTokens = promptTokens + systemTokens;
  const outputTokens = Math.ceil(inputTokens * 0.6);
  const tokens = inputTokens + outputTokens;

  // Latency: sonnet ~500ms, opus ~1500ms, with +-20% variance
  const baseLatency = tier === 'opus' ? 1500 : tier === 'sonnet' ? 500 : 800;
  const latency = Math.max(50, withVariance(baseLatency, 0.2));

  // Mock output text
  const output = `[mock-${model}-run-${runIndex}] Simulated response for "${spec.name}".`;

  return {
    runIndex,
    score: Math.round(score * 1000) / 1000,
    tokens: Math.round(tokens),
    latency: Math.round(latency),
    output,
  };
}

/**
 * Compute estimated cost for a set of benchmark runs using the model registry.
 * Falls back to zero when the model is not in the registry.
 */
function computeCost(
  runs: BenchmarkRun[],
  model: string,
  spec: PromptSpec,
): number {
  const modelInfo = getModel(model);
  if (!modelInfo) return 0;

  const promptTokens = estimateTokens(spec.prompt);
  const systemTokens = estimateTokens(spec.system ?? '');
  const inputTokensPerRun = promptTokens + systemTokens;

  let totalCost = 0;
  for (const run of runs) {
    const outputTokens = Math.max(0, run.tokens - inputTokensPerRun);
    totalCost += registryEstimateCost(model, inputTokensPerRun, outputTokens);
  }

  return totalCost;
}

/**
 * Parse a YAML prompt spec file. Returns the parsed spec or throws on
 * invalid input.
 */
async function loadSpec(specPath: string): Promise<PromptSpec> {
  const content = await readFile(specPath, 'utf-8');
  const raw = yaml.load(content);

  if (raw === null || raw === undefined || typeof raw !== 'object') {
    throw new Error(`Invalid prompt spec at ${specPath}: expected a YAML object`);
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj['prompt'] !== 'string' || !obj['prompt']) {
    throw new Error(`Prompt spec at ${specPath} is missing a "prompt" field`);
  }

  return {
    name: typeof obj['name'] === 'string' ? obj['name'] : specPath,
    description: typeof obj['description'] === 'string' ? obj['description'] : undefined,
    model: typeof obj['model'] === 'string' ? obj['model'] : undefined,
    system: typeof obj['system'] === 'string' ? obj['system'] : undefined,
    prompt: obj['prompt'],
    tests: Array.isArray(obj['tests']) ? parseTests(obj['tests']) : undefined,
  };
}

/**
 * Parse the tests array from a raw YAML structure.
 */
function parseTests(rawTests: unknown[]): PromptSpec['tests'] {
  return rawTests
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t) => ({
      name: typeof t['name'] === 'string' ? t['name'] : 'unnamed',
      input: typeof t['input'] === 'string' ? t['input'] : undefined,
      inputFile: typeof t['inputFile'] === 'string' ? t['inputFile'] : undefined,
      expect:
        typeof t['expect'] === 'object' && t['expect'] !== null
          ? (t['expect'] as PromptSpec['tests'] extends Array<infer U> ? U extends { expect?: infer E } ? E : never : never)
          : undefined,
    }));
}

/**
 * Run benchmarks for a prompt spec across one or more models.
 *
 * @param specPath  Path to a YAML prompt spec file.
 * @param options   Benchmark configuration.
 * @returns         An array of results, one per model.
 */
export async function runBenchmark(
  specPath: string,
  options: BenchmarkOptions = {},
): Promise<BenchmarkResult[]> {
  const {
    models = DEFAULT_MODELS,
    runs = DEFAULT_RUNS,
    mode = 'mock',
  } = options;

  const spec = await loadSpec(specPath);
  const results: BenchmarkResult[] = [];

  for (const model of models) {
    const benchmarkRuns: BenchmarkRun[] = [];

    for (let i = 0; i < runs; i++) {
      if (mode === 'mock') {
        benchmarkRuns.push(generateMockRun(i, spec, model));
      } else {
        // Live mode: call the appropriate provider via factory.
        const { createProvider } = await import('./providers/factory.js');
        const provider = createProvider(model);

        const testInput = spec.tests?.[0]?.input ?? 'Hello';
        const fullPrompt = spec.prompt.replace(/\{\{input\}\}/g, testInput);
        const start = Date.now();

        const response = await provider.call({
          model,
          system: spec.system,
          messages: [{ role: 'user', content: fullPrompt }],
        });

        const latency = Date.now() - start;
        benchmarkRuns.push({
          runIndex: i,
          score: 1.0, // Live mode: user evaluates quality
          tokens: response.inputTokens + response.outputTokens,
          latency,
          output: response.content,
        });
      }
    }

    const totalScore = benchmarkRuns.reduce((sum, r) => sum + r.score, 0);
    const totalTokens = benchmarkRuns.reduce((sum, r) => sum + r.tokens, 0);
    const totalLatency = benchmarkRuns.reduce((sum, r) => sum + r.latency, 0);
    const runCount = benchmarkRuns.length;

    results.push({
      model,
      promptName: spec.name,
      runs: benchmarkRuns,
      averageScore: runCount > 0 ? Math.round((totalScore / runCount) * 1000) / 1000 : 0,
      averageTokens: runCount > 0 ? Math.round(totalTokens / runCount) : 0,
      averageLatency: runCount > 0 ? Math.round(totalLatency / runCount) : 0,
      estimatedCost: computeCost(benchmarkRuns, model, spec),
    });
  }

  return results;
}
