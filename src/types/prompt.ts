/**
 * Prompt specification and test result types.
 */

export interface PromptSpec {
  name: string;
  description?: string;
  model?: string;
  system?: string;
  prompt: string;
  tests?: PromptTest[];
}

export interface PromptTest {
  name: string;
  input?: string;
  inputFile?: string;
  expect?: TestExpectation;
}

export interface TestExpectation {
  contains?: string[];
  notContains?: string[];
  regex?: string[];
  equals?: string;
  jsonSchema?: Record<string, unknown>;
  // Advanced assertion types
  minLength?: number;
  maxLength?: number;
  lineCount?: number;
  wordCount?: { min?: number; max?: number };
  startsWith?: string;
  endsWith?: string;
  isSorted?: boolean;
  custom?: string; // JS function body as string: (output) => boolean
  // LLM-as-judge assertion
  judge?: Array<{
    criteria: string;
    threshold?: number;  // 0-1, default 0.7
    model?: string;      // default: spec's model
  }>;
}

export interface TestResult {
  testName: string;
  promptName: string;
  passed: boolean;
  output: string;
  duration: number;
  assertions: AssertionResult[];
  cached: boolean;
  error?: string;
}

export interface AssertionResult {
  type: string;
  expected: string;
  actual?: string;
  passed: boolean;
}

export type ExecutionMode = 'mock' | 'live';
