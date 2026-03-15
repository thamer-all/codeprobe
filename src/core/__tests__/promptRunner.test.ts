import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  parsePromptSpec,
  evaluateAssertions,
  runSingleTest,
} from '../../core/promptRunner.js';
import type { PromptSpec, PromptTest, TestExpectation } from '../../types/prompt.js';

const SPEC_PATH = resolve(
  import.meta.dirname,
  '../../../prompts/summarize.prompt.yaml',
);

describe('parsePromptSpec', () => {
  it('reads summarize.prompt.yaml and returns a valid PromptSpec', async () => {
    const spec = await parsePromptSpec(SPEC_PATH);
    expect(spec.name).toBe('summarize');
    expect(spec.system).toBeDefined();
    expect(typeof spec.system).toBe('string');
    expect(spec.prompt).toBeDefined();
    expect(typeof spec.prompt).toBe('string');
    expect(spec.tests).toBeDefined();
    expect(Array.isArray(spec.tests)).toBe(true);
    expect(spec.tests!.length).toBeGreaterThan(0);
  });
});

describe('evaluateAssertions', () => {
  it('contains: passes when output includes the string', async () => {
    const expectations: TestExpectation = { contains: ['hello'] };
    const results = await evaluateAssertions('hello world', expectations);
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(true);
  });

  it('contains: fails when output does not include the string', async () => {
    const expectations: TestExpectation = { contains: ['goodbye'] };
    const results = await evaluateAssertions('hello world', expectations);
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(false);
  });

  it('notContains: passes when output does not include the string', async () => {
    const expectations: TestExpectation = { notContains: ['goodbye'] };
    const results = await evaluateAssertions('hello world', expectations);
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(true);
  });

  it('regex: passes when pattern matches (with m flag)', async () => {
    const expectations: TestExpectation = { regex: ['^- '] };
    const output = '- bullet point one\n- bullet point two';
    const results = await evaluateAssertions(output, expectations);
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(true);
  });

  it('regex: fails when pattern does not match', async () => {
    const expectations: TestExpectation = { regex: ['^\\d{4}-\\d{2}-\\d{2}$'] };
    const output = 'no date here';
    const results = await evaluateAssertions(output, expectations);
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(false);
  });

  it('equals: passes on exact match (trimmed)', async () => {
    const expectations: TestExpectation = { equals: 'exact match' };
    const results = await evaluateAssertions('  exact match  ', expectations);
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(true);
  });
});

describe('runSingleTest', () => {
  it('returns a TestResult with passed=true for a matching mock test', async () => {
    const spec: PromptSpec = {
      name: 'test-spec',
      prompt: 'Summarize this list of items',
      system: 'You are a helpful assistant. Respond with bullet points.',
    };

    const test: PromptTest = {
      name: 'mock-test',
      input: 'Some input text about TypeScript and JavaScript',
      expect: {
        contains: ['key insight'],
        regex: ['^- '],
      },
    };

    const result = await runSingleTest(spec, test, {
      mode: 'mock',
      cache: false,
    });

    expect(result.testName).toBe('mock-test');
    expect(result.promptName).toBe('test-spec');
    expect(result.passed).toBe(true);
    expect(result.output).toBeTruthy();
    expect(result.assertions.length).toBeGreaterThan(0);
  });
});
