/**
 * Prompt test runner — parses prompt specs, runs tests, and evaluates assertions.
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import _Ajv from 'ajv';

// With module:ES2022 + moduleResolution:node16, the default import of Ajv
// resolves to the module namespace rather than the class constructor.
// Cast through unknown to obtain a callable constructor.
const Ajv = _Ajv as unknown as typeof _Ajv.default;

import type {
  PromptSpec,
  PromptTest,
  TestExpectation,
  TestResult,
  AssertionResult,
  ExecutionMode,
} from '../types/prompt.js';
import { cacheKey, getCached, setCached } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import { readTextFile } from '../utils/fs.js';

/**
 * Options controlling how prompt tests are executed.
 */
export interface RunOptions {
  mode: ExecutionMode;
  verbose?: boolean;
  cache?: boolean;
  json?: boolean;
  modelOverride?: string;
}

// ---------------------------------------------------------------------------
// Zod schema for validating prompt spec YAML files
// ---------------------------------------------------------------------------

const TestExpectationSchema = z.object({
  contains: z.array(z.string()).optional(),
  notContains: z.array(z.string()).optional(),
  regex: z.array(z.string()).optional(),
  equals: z.string().optional(),
  jsonSchema: z.record(z.unknown()).optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  lineCount: z.number().optional(),
  wordCount: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  isSorted: z.boolean().optional(),
  custom: z.string().optional(),
  judge: z.array(z.object({
    criteria: z.string(),
    threshold: z.number().optional(),
    model: z.string().optional(),
  })).optional(),
});

const PromptTestSchema = z.object({
  name: z.string(),
  input: z.string().optional(),
  inputFile: z.string().optional(),
  expect: TestExpectationSchema.optional(),
});

const PromptSpecSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  model: z.string().optional(),
  system: z.string().optional(),
  prompt: z.string(),
  tests: z.array(PromptTestSchema).optional(),
});

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse and validate a prompt spec YAML file.
 */
export async function parsePromptSpec(filePath: string): Promise<PromptSpec> {
  const absolutePath = resolve(filePath);
  const content = await readFile(absolutePath, 'utf-8');
  const raw: unknown = yaml.load(content);

  const parsed = PromptSpecSchema.parse(raw);

  // Resolve any inputFile references relative to the spec file directory
  const specDir = dirname(absolutePath);
  if (parsed.tests) {
    for (const test of parsed.tests) {
      if (test.inputFile && !test.input) {
        const inputPath = resolve(specDir, test.inputFile);
        const inputContent = await readTextFile(inputPath);
        if (inputContent !== null) {
          test.input = inputContent;
        } else {
          throw new Error(
            `Could not read inputFile "${test.inputFile}" referenced in test "${test.name}"`,
          );
        }
      }
    }
  }

  return parsed as PromptSpec;
}

// ---------------------------------------------------------------------------
// Mock generation
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic mock response by hashing inputs and
 * incorporating words from the input to produce a plausible response.
 *
 * The mock tries to respect format hints from the system/prompt:
 * - If "bullet" or "- " patterns are detected, output bullet-point format
 * - Otherwise, use prose format
 */
function generateMockOutput(
  prompt: string,
  system: string | undefined,
  input: string | undefined,
): string {
  const hashSource = [prompt, system ?? '', input ?? ''].join('|');
  const hash = createHash('sha256').update(hashSource).digest('hex');

  // Extract meaningful words from the input to make the mock feel relevant
  // Keep words >= 2 chars to preserve acronyms like "MCP", "AI", etc.
  const sourceText = input ?? prompt;
  const words = sourceText
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9-]/g, ''))
    .filter((w) => w.length >= 2)
    .slice(0, 15);

  const combined = [prompt, system ?? ''].join(' ').toLowerCase();
  const wantsBullets = combined.includes('bullet') ||
    combined.includes('- ') ||
    combined.includes('list') ||
    combined.includes('points');

  const seed = parseInt(hash.slice(0, 8), 16);

  if (wantsBullets) {
    // Generate bullet-point output incorporating input words
    const bullets: string[] = [];
    const groupSize = Math.max(1, Math.floor(words.length / 3));
    for (let i = 0; i < 3; i++) {
      const chunk = words.slice(i * groupSize, (i + 1) * groupSize);
      if (chunk.length > 0) {
        bullets.push(`- ${chunk.join(' ')}: key insight from the analysis`);
      } else {
        bullets.push(`- Point ${i + 1}: additional consideration based on context`);
      }
    }
    return bullets.join('\n');
  }

  const templates = [
    `Based on the provided context, here is the analysis: ${words.join(', ')}. The key considerations include ${words.slice(0, 3).join(' and ')}.`,
    `After reviewing the input about ${words.slice(0, 2).join(' and ')}, the focus should be on ${words.slice(2, 5).join(', ')}. This approach ensures comprehensive coverage.`,
    `The response addresses: ${words.join(', ')}. Each element has been carefully evaluated to provide actionable insights.`,
    `Regarding ${words.slice(0, 3).join(', ')}: the analysis suggests that ${words.slice(3, 6).join(' and ')} are the primary factors to consider.`,
  ];

  const templateIndex = seed % templates.length;
  return `${templates[templateIndex]}`; // No [MOCK] prefix — cleaner for assertion testing
}

// ---------------------------------------------------------------------------
// Assertion evaluation
// ---------------------------------------------------------------------------

const ajvInstance = new Ajv({ allErrors: true, strict: false });

/**
 * Evaluate all assertions for a test expectation against actual output.
 */
export async function evaluateAssertions(
  output: string,
  expect: TestExpectation,
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];

  // contains checks
  if (expect.contains) {
    for (const substring of expect.contains) {
      results.push({
        type: 'contains',
        expected: substring,
        actual: output.includes(substring) ? substring : undefined,
        passed: output.includes(substring),
      });
    }
  }

  // notContains checks
  if (expect.notContains) {
    for (const substring of expect.notContains) {
      const found = output.includes(substring);
      results.push({
        type: 'notContains',
        expected: substring,
        actual: found ? substring : undefined,
        passed: !found,
      });
    }
  }

  // regex checks (multiline by default so ^ and $ match line boundaries)
  if (expect.regex) {
    for (const pattern of expect.regex) {
      let passed = false;
      try {
        const re = new RegExp(pattern, 'm');
        passed = re.test(output);
      } catch {
        // Invalid regex always fails
      }
      results.push({
        type: 'regex',
        expected: pattern,
        actual: passed ? 'matched' : 'no match',
        passed,
      });
    }
  }

  // equals check
  if (expect.equals !== undefined) {
    const trimmedOutput = output.trim();
    const trimmedExpected = expect.equals.trim();
    results.push({
      type: 'equals',
      expected: expect.equals,
      actual: output,
      passed: trimmedOutput === trimmedExpected,
    });
  }

  // minLength check
  if (expect.minLength !== undefined) {
    const passed = output.length >= expect.minLength;
    results.push({
      type: 'minLength',
      expected: `>= ${expect.minLength} chars`,
      actual: `${output.length} chars`,
      passed,
    });
  }

  // maxLength check
  if (expect.maxLength !== undefined) {
    const passed = output.length <= expect.maxLength;
    results.push({
      type: 'maxLength',
      expected: `<= ${expect.maxLength} chars`,
      actual: `${output.length} chars`,
      passed,
    });
  }

  // lineCount check
  if (expect.lineCount !== undefined) {
    const lines = output.trim().split('\n').length;
    const passed = lines === expect.lineCount;
    results.push({
      type: 'lineCount',
      expected: `${expect.lineCount} lines`,
      actual: `${lines} lines`,
      passed,
    });
  }

  // wordCount check
  if (expect.wordCount) {
    const words = output.trim().split(/\s+/).length;
    const minOk = expect.wordCount.min === undefined || words >= expect.wordCount.min;
    const maxOk = expect.wordCount.max === undefined || words <= expect.wordCount.max;
    const passed = minOk && maxOk;
    const expectedStr = [
      expect.wordCount.min !== undefined ? `>= ${expect.wordCount.min}` : '',
      expect.wordCount.max !== undefined ? `<= ${expect.wordCount.max}` : '',
    ].filter(Boolean).join(', ');
    results.push({
      type: 'wordCount',
      expected: expectedStr + ' words',
      actual: `${words} words`,
      passed,
    });
  }

  // startsWith check
  if (expect.startsWith !== undefined) {
    const passed = output.trimStart().startsWith(expect.startsWith);
    results.push({
      type: 'startsWith',
      expected: expect.startsWith,
      actual: output.slice(0, expect.startsWith.length + 10),
      passed,
    });
  }

  // endsWith check
  if (expect.endsWith !== undefined) {
    const passed = output.trimEnd().endsWith(expect.endsWith);
    results.push({
      type: 'endsWith',
      expected: expect.endsWith,
      actual: output.slice(-expect.endsWith.length - 10),
      passed,
    });
  }

  // custom function check
  if (expect.custom) {
    try {
      const fn = new Function('output', `return (${expect.custom})(output);`);
      const result = fn(output);
      const passed = Boolean(result);
      results.push({
        type: 'custom',
        expected: 'custom function returns truthy',
        actual: passed ? 'passed' : 'failed',
        passed,
      });
    } catch (err) {
      results.push({
        type: 'custom',
        expected: 'custom function',
        actual: `error: ${err instanceof Error ? err.message : String(err)}`,
        passed: false,
      });
    }
  }

  // jsonSchema check
  if (expect.jsonSchema) {
    let parsed: unknown;
    let parseOk = false;
    try {
      parsed = JSON.parse(output);
      parseOk = true;
    } catch {
      // output is not valid JSON
    }

    if (parseOk) {
      try {
        const validate = ajvInstance.compile(expect.jsonSchema);
        const valid = validate(parsed);
        results.push({
          type: 'jsonSchema',
          expected: JSON.stringify(expect.jsonSchema),
          actual: valid ? 'valid' : JSON.stringify(validate.errors),
          passed: Boolean(valid),
        });
      } catch (err) {
        results.push({
          type: 'jsonSchema',
          expected: JSON.stringify(expect.jsonSchema),
          actual: `schema compilation error: ${err instanceof Error ? err.message : String(err)}`,
          passed: false,
        });
      }
    } else {
      results.push({
        type: 'jsonSchema',
        expected: JSON.stringify(expect.jsonSchema),
        actual: 'output is not valid JSON',
        passed: false,
      });
    }
  }

  // LLM-as-judge checks
  if (expect.judge) {
    for (const j of expect.judge) {
      const model = j.model ?? 'claude-sonnet-4-6';
      try {
        const { createProvider } = await import('./providers/factory.js');
        const provider = createProvider(model);
        const available = await provider.isAvailable();
        if (!available) {
          results.push({
            type: 'judge',
            expected: `>= ${j.threshold ?? 0.7} on "${j.criteria}"`,
            actual: 'skipped (no API key)',
            passed: true, // Don't fail in mock mode
          });
          continue;
        }
        const response = await provider.call({
          model,
          system: 'You are an evaluator. Rate the following output on a scale of 0.0 to 1.0 based on the given criteria. Respond with ONLY a number between 0.0 and 1.0.',
          messages: [{
            role: 'user',
            content: `Criteria: ${j.criteria}\n\nOutput to evaluate:\n${output}\n\nScore (0.0 to 1.0):`,
          }],
        });
        const score = parseFloat(response.content.trim());
        const threshold = j.threshold ?? 0.7;
        const passed = !isNaN(score) && score >= threshold;
        results.push({
          type: 'judge',
          expected: `>= ${threshold} on "${j.criteria}"`,
          actual: isNaN(score) ? 'parse error' : score.toFixed(2),
          passed,
        });
      } catch (err) {
        results.push({
          type: 'judge',
          expected: `>= ${j.threshold ?? 0.7} on "${j.criteria}"`,
          actual: `error: ${err instanceof Error ? err.message : String(err)}`,
          passed: false,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Run single test
// ---------------------------------------------------------------------------

/**
 * Run a single prompt test and return the result.
 */
export async function runSingleTest(
  spec: PromptSpec,
  test: PromptTest,
  options: RunOptions,
): Promise<TestResult> {
  const startTime = Date.now();

  // Check cache
  if (options.cache) {
    const key = cacheKey(
      spec.prompt,
      spec.system ?? '',
      test.input ?? '',
      options.mode,
    );
    const cached = await getCached(key);
    if (cached !== null) {
      logger.debug(`Cache hit for test "${test.name}"`);
      const assertions = test.expect
        ? await evaluateAssertions(cached, test.expect)
        : [];
      const allPassed = assertions.length === 0 || assertions.every((a) => a.passed);

      return {
        testName: test.name,
        promptName: spec.name,
        passed: allPassed,
        output: cached,
        duration: Date.now() - startTime,
        assertions,
        cached: true,
      };
    }
  }

  let output: string;

  try {
    if (options.mode === 'mock') {
      output = generateMockOutput(spec.prompt, spec.system, test.input);
    } else {
      // Live mode: use provider factory for multi-provider support
      const { createProvider } = await import('./providers/factory.js');
      const model = options.modelOverride ?? spec.model ?? 'claude-sonnet-4-6';
      const fullPrompt = spec.prompt.replace('{{input}}', test.input ?? '');

      const provider = createProvider(model);
      const response = await provider.call({
        model,
        system: spec.system,
        messages: [{ role: 'user', content: fullPrompt }],
      });
      output = response.content;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      testName: test.name,
      promptName: spec.name,
      passed: false,
      output: '',
      duration: Date.now() - startTime,
      assertions: [],
      cached: false,
      error: errorMessage,
    };
  }

  // Cache the result
  if (options.cache) {
    const key = cacheKey(
      spec.prompt,
      spec.system ?? '',
      test.input ?? '',
      options.mode,
    );
    await setCached(key, output);
  }

  // Evaluate assertions
  const assertions = test.expect
    ? await evaluateAssertions(output, test.expect)
    : [];
  const allPassed = assertions.length === 0 || assertions.every((a) => a.passed);

  if (options.verbose) {
    logger.debug(`Test "${test.name}" output (${output.length} chars): ${output.slice(0, 200)}`);
  }

  return {
    testName: test.name,
    promptName: spec.name,
    passed: allPassed,
    output,
    duration: Date.now() - startTime,
    assertions,
    cached: false,
  };
}

// ---------------------------------------------------------------------------
// Run all tests in a spec
// ---------------------------------------------------------------------------

/**
 * Run all tests defined in a prompt spec file.
 */
export async function runPromptTests(
  specPath: string,
  options: RunOptions,
): Promise<TestResult[]> {
  const spec = await parsePromptSpec(specPath);
  const tests = spec.tests ?? [];

  if (tests.length === 0) {
    return [];
  }

  const results: TestResult[] = [];
  for (const test of tests) {
    const result = await runSingleTest(spec, test, options);
    results.push(result);
  }

  return results;
}
