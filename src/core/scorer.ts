/**
 * Scoring engine that evaluates prompt outputs on multiple criteria
 * and produces a 0-100 score with an A-F grade.
 *
 * All scoring is heuristic — no API calls are made.
 */

import type { PromptSpec, PromptTest } from '../types/prompt.js';
import { evaluateAssertions } from './promptRunner.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CriterionScore {
  name: string;
  score: number;   // 0-100
  weight: number;  // 0-1
  details: string;
}

export interface ScoreResult {
  overall: number;          // 0-100
  criteria: CriterionScore[];
  grade: string;            // A, B, C, D, F
}

// ---------------------------------------------------------------------------
// Grade mapping
// ---------------------------------------------------------------------------

function gradeFromScore(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

// ---------------------------------------------------------------------------
// Criterion 1: Assertion pass rate (weight 0.4)
// ---------------------------------------------------------------------------

async function scoreAssertions(output: string, test: PromptTest): Promise<CriterionScore> {
  const expect = test.expect;
  if (!expect) {
    return {
      name: 'Assertions',
      score: 100,
      weight: 0.4,
      details: 'No assertions defined — full marks by default',
    };
  }

  const results = await evaluateAssertions(output, expect);
  if (results.length === 0) {
    return {
      name: 'Assertions',
      score: 100,
      weight: 0.4,
      details: 'No assertions evaluated — full marks by default',
    };
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const rate = passed / total;
  const score = Math.round(rate * 100);

  return {
    name: 'Assertions',
    score,
    weight: 0.4,
    details: `${passed}/${total} assertions passed (${score}%)`,
  };
}

// ---------------------------------------------------------------------------
// Criterion 2: Length appropriateness (weight 0.15)
// ---------------------------------------------------------------------------

function scoreLengthAppropriateness(output: string, spec: PromptSpec, test: PromptTest): CriterionScore {
  const inputText = test.input ?? spec.prompt;
  const inputLength = inputText.length;
  const outputLength = output.length;

  // Heuristics:
  // - Output should not be empty
  // - Output should not be excessively short (< 10 chars) or excessively long (> 20x input)
  // - A reasonable ratio is between 0.1x and 5x the input length

  if (outputLength === 0) {
    return {
      name: 'Length',
      score: 0,
      weight: 0.15,
      details: 'Output is empty',
    };
  }

  // Check explicit length constraints from the test expectations
  const expect = test.expect;
  let penaltyFromConstraints = 0;
  if (expect?.minLength !== undefined && outputLength < expect.minLength) {
    penaltyFromConstraints += 40;
  }
  if (expect?.maxLength !== undefined && outputLength > expect.maxLength) {
    penaltyFromConstraints += 40;
  }

  // General heuristic: output ratio
  const ratio = outputLength / Math.max(inputLength, 1);
  let heuristicScore = 100;

  if (outputLength < 10) {
    heuristicScore = 20;
  } else if (ratio < 0.05) {
    // Very short compared to input
    heuristicScore = 50;
  } else if (ratio > 20) {
    // Excessively long compared to input
    heuristicScore = 60;
  } else if (ratio >= 0.1 && ratio <= 5) {
    // Sweet spot
    heuristicScore = 100;
  } else {
    // Acceptable but not ideal
    heuristicScore = 80;
  }

  const score = Math.max(0, Math.min(100, heuristicScore - penaltyFromConstraints));

  return {
    name: 'Length',
    score,
    weight: 0.15,
    details: `Output: ${outputLength} chars, Input: ${inputLength} chars (ratio: ${ratio.toFixed(2)})`,
  };
}

// ---------------------------------------------------------------------------
// Criterion 3: Format compliance (weight 0.15)
// ---------------------------------------------------------------------------

function scoreFormatCompliance(output: string, spec: PromptSpec): CriterionScore {
  const combined = [spec.prompt, spec.system ?? ''].join(' ').toLowerCase();

  const checks: Array<{ hint: string; detected: boolean; present: boolean }> = [];

  // Check for bullet point format hints
  const wantsBullets = combined.includes('bullet') ||
    combined.includes('- ') ||
    /\blist\b/.test(combined) ||
    /\bpoints?\b/.test(combined);

  if (wantsBullets) {
    const hasBullets = /^[\s]*[-*]\s/m.test(output);
    checks.push({ hint: 'bullet points', detected: true, present: hasBullets });
  }

  // Check for JSON format hints
  const wantsJson = combined.includes('json') || combined.includes('object');
  if (wantsJson) {
    let isValidJson = false;
    try {
      JSON.parse(output.trim());
      isValidJson = true;
    } catch {
      // Not valid JSON
    }
    checks.push({ hint: 'JSON format', detected: true, present: isValidJson });
  }

  // Check for numbered list format hints
  const wantsNumbered = combined.includes('numbered') || combined.includes('step');
  if (wantsNumbered) {
    const hasNumbers = /^\s*\d+[.)]\s/m.test(output);
    checks.push({ hint: 'numbered list', detected: true, present: hasNumbers });
  }

  // Check for heading/section hints
  const wantsHeadings = combined.includes('heading') || combined.includes('section');
  if (wantsHeadings) {
    const hasHeadings = /^#+\s/m.test(output) || /^[A-Z][^.!?]*:$/m.test(output);
    checks.push({ hint: 'headings', detected: true, present: hasHeadings });
  }

  if (checks.length === 0) {
    return {
      name: 'Format',
      score: 80,
      weight: 0.15,
      details: 'No specific format hints detected in prompt — default score',
    };
  }

  const matched = checks.filter((c) => c.present).length;
  const score = Math.round((matched / checks.length) * 100);
  const matchedHints = checks
    .map((c) => `${c.hint}: ${c.present ? 'yes' : 'no'}`)
    .join(', ');

  return {
    name: 'Format',
    score,
    weight: 0.15,
    details: `Format checks: ${matchedHints}`,
  };
}

// ---------------------------------------------------------------------------
// Criterion 4: Relevance — word overlap (weight 0.15)
// ---------------------------------------------------------------------------

function scoreRelevance(output: string, spec: PromptSpec, test: PromptTest): CriterionScore {
  const inputText = test.input ?? spec.prompt;

  // Extract meaningful words from the input (>= 3 chars, lowercase, no stopwords)
  const stopwords = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'are', 'was', 'were', 'been',
    'has', 'have', 'had', 'not', 'but', 'can', 'will', 'from', 'they', 'them',
    'its', 'you', 'your', 'all', 'about', 'into', 'also', 'more', 'some',
    'than', 'each', 'which', 'their', 'would', 'could', 'should', 'there',
  ]);

  const extractWords = (text: string): Set<string> => {
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopwords.has(w));
    return new Set(words);
  };

  const inputWords = extractWords(inputText);
  const outputWords = extractWords(output);

  if (inputWords.size === 0) {
    return {
      name: 'Relevance',
      score: 80,
      weight: 0.15,
      details: 'No meaningful input words to compare — default score',
    };
  }

  // Calculate overlap: what fraction of input keywords appear in the output?
  let overlap = 0;
  for (const word of inputWords) {
    if (outputWords.has(word)) {
      overlap++;
    }
  }

  const overlapRate = overlap / inputWords.size;

  // Score: scale 0-1 overlap to 0-100, with a floor at 20 for non-empty output
  let score: number;
  if (output.trim().length === 0) {
    score = 0;
  } else {
    // Use a generous curve: 30% overlap is already quite good for a summary
    score = Math.min(100, Math.round(overlapRate * 200));
    score = Math.max(score, 20); // At least 20 for producing any response
  }

  return {
    name: 'Relevance',
    score,
    weight: 0.15,
    details: `${overlap}/${inputWords.size} input keywords found in output (${Math.round(overlapRate * 100)}% overlap)`,
  };
}

// ---------------------------------------------------------------------------
// Criterion 5: Completeness (weight 0.15)
// ---------------------------------------------------------------------------

function scoreCompleteness(output: string): CriterionScore {
  const trimmed = output.trim();

  if (trimmed.length === 0) {
    return {
      name: 'Completeness',
      score: 0,
      weight: 0.15,
      details: 'Output is empty',
    };
  }

  let score = 100;
  const issues: string[] = [];

  // Check 1: Does it end mid-sentence? (ends with common incomplete indicators)
  const lastChar = trimmed[trimmed.length - 1]!;
  const sentenceEnders = new Set(['.', '!', '?', ':', ';', ')', ']', '}', '"', "'", '`']);
  const bulletEnder = /[-*]\s*$/;

  if (!sentenceEnders.has(lastChar) && !bulletEnder.test(trimmed)) {
    // Might be mid-sentence — penalize unless it's a list item
    const lastLine = trimmed.split('\n').pop() ?? '';
    const isListItem = /^[\s]*[-*\d.]+\s/.test(lastLine);
    if (!isListItem) {
      score -= 20;
      issues.push('may end mid-sentence');
    }
  }

  // Check 2: Very short output (< 20 chars) is likely incomplete
  if (trimmed.length < 20) {
    score -= 15;
    issues.push('very short output');
  }

  // Check 3: Unbalanced brackets/quotes suggest truncation
  const brackets: Array<[string, string]> = [['(', ')'], ['[', ']'], ['{', '}']];
  for (const [open, close] of brackets) {
    const openCount = (trimmed.match(new RegExp(`\\${open}`, 'g')) ?? []).length;
    const closeCount = (trimmed.match(new RegExp(`\\${close}`, 'g')) ?? []).length;
    if (openCount > closeCount) {
      score -= 10;
      issues.push(`unbalanced ${open}${close}`);
      break; // Only penalize once for bracket issues
    }
  }

  // Check 4: Ends with ellipsis or continuation markers
  if (trimmed.endsWith('...') || trimmed.endsWith('etc') || trimmed.endsWith('and so on')) {
    score -= 5;
    issues.push('ends with continuation marker');
  }

  score = Math.max(0, score);

  return {
    name: 'Completeness',
    score,
    weight: 0.15,
    details: issues.length > 0
      ? `Issues: ${issues.join(', ')}`
      : 'Output appears complete and well-formed',
  };
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

/**
 * Score a prompt output on multiple criteria and produce a 0-100 score.
 *
 * Criteria and weights:
 *   1. Assertion pass rate   (0.40)
 *   2. Length appropriateness (0.15)
 *   3. Format compliance      (0.15)
 *   4. Relevance              (0.15)
 *   5. Completeness           (0.15)
 */
export async function scoreOutput(output: string, spec: PromptSpec, test: PromptTest): Promise<ScoreResult> {
  const criteria: CriterionScore[] = [
    await scoreAssertions(output, test),
    scoreLengthAppropriateness(output, spec, test),
    scoreFormatCompliance(output, spec),
    scoreRelevance(output, spec, test),
    scoreCompleteness(output),
  ];

  // Weighted average
  const weightedSum = criteria.reduce((sum, c) => sum + c.score * c.weight, 0);
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  const overall = Math.round(weightedSum / totalWeight);

  return {
    overall,
    criteria,
    grade: gradeFromScore(overall),
  };
}
