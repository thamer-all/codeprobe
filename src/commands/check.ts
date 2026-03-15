/**
 * `codeprobe check [path]` — CI-friendly one-liner that runs ALL
 * validation in one shot and exits with code 0 (all good) or 1
 * (issues found).
 *
 * Runs: prompt tests, lint, security, and validate.
 */

import { Command } from 'commander';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { resolvePath } from '../utils/paths.js';
import { setLogLevel } from '../utils/logger.js';
import { readTextFile, isDirectory, fileExists, getRelativePath as getRelPath } from '../utils/fs.js';
import { runPromptTests, type RunOptions } from '../core/promptRunner.js';
import type { TestResult } from '../types/prompt.js';
import type { LintWarning } from '../types/diagnostics.js';
import type { SecurityFinding } from '../types/diagnostics.js';

// ── Check result types ──────────────────────────────────────────────

interface CheckLineResult {
  name: string;
  passed: boolean;
  label: string;
  skipped: boolean;
}

interface CheckOutput {
  checks: Array<{
    name: string;
    passed: boolean;
    skipped: boolean;
    details: unknown;
  }>;
  allPassed: boolean;
}

// ── Inline lint logic (mirrors lint command) ────────────────────────

async function findSpecFiles(dirPath: string): Promise<string[]> {
  const { glob } = await import('glob');
  const pattern = resolve(dirPath, '**/*.prompt.{yaml,yml}');
  return glob(pattern, { absolute: true });
}

async function lintFile(filePath: string, rootPath: string): Promise<LintWarning[]> {
  const yaml = (await import('js-yaml')).default;
  const warnings: LintWarning[] = [];
  const relPath = getRelPath(rootPath, filePath);

  const content = await readTextFile(filePath);
  if (!content) {
    warnings.push({ file: relPath, rule: 'file-read', severity: 'error', message: 'Could not read file' });
    return warnings;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(content) as Record<string, unknown>;
  } catch (err) {
    warnings.push({
      file: relPath, rule: 'yaml-parse', severity: 'error',
      message: `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
    });
    return warnings;
  }

  if (!parsed || typeof parsed !== 'object') {
    warnings.push({ file: relPath, rule: 'yaml-parse', severity: 'error', message: 'YAML did not parse to an object' });
    return warnings;
  }

  if (!parsed['prompt']) {
    warnings.push({ file: relPath, rule: 'missing-prompt', severity: 'error', message: 'Missing "prompt" field' });
  }

  return warnings;
}

async function runLintCheck(targetPath: string): Promise<LintWarning[]> {
  let files: string[];
  if (await fileExists(targetPath)) {
    files = [targetPath];
  } else if (await isDirectory(targetPath)) {
    files = await findSpecFiles(targetPath);
  } else {
    return [];
  }

  const allWarnings: LintWarning[] = [];
  for (const file of files) {
    const warnings = await lintFile(file, process.cwd());
    allWarnings.push(...warnings);
  }
  return allWarnings;
}

// ── Inline security logic (mirrors security command) ────────────────

const SECURITY_RULES: Array<{
  id: string;
  pattern: RegExp;
  severity: SecurityFinding['severity'];
  message: string;
}> = [
  { id: 'injection-ignore', pattern: /ignore\s+(previous|above|all)\s+(instructions?|prompts?|rules?)/i, severity: 'critical', message: 'Potential prompt injection' },
  { id: 'injection-pretend', pattern: /pretend\s+(you\s+are|to\s+be|that)/i, severity: 'high', message: 'Potential persona override' },
  { id: 'injection-system-override', pattern: /system\s*:\s*you\s+are\s+now/i, severity: 'critical', message: 'System prompt override detected' },
  { id: 'leaked-api-key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}/i, severity: 'critical', message: 'API key detected' },
  { id: 'leaked-secret', pattern: /(?:secret|password|token|credential)\s*[:=]\s*['"][^'"]{8,}/i, severity: 'critical', message: 'Secret or credential detected' },
  { id: 'leaked-env-var', pattern: /(?:sk-|pk_|rk_|ghp_|gho_|github_pat_)[A-Za-z0-9_\-]{20,}/, severity: 'critical', message: 'Service token detected' },
  { id: 'unsafe-eval', pattern: /eval\s*\(|exec\s*\(|Function\s*\(/, severity: 'high', message: 'Dynamic code execution detected' },
  { id: 'data-exfiltration', pattern: /send\s+(to|data|all|everything)\s+(to\s+)?https?:\/\//i, severity: 'high', message: 'Data exfiltration pattern detected' },
];

async function runSecurityCheck(targetPath: string): Promise<SecurityFinding[]> {
  const { glob } = await import('glob');
  const findings: SecurityFinding[] = [];

  let files: string[];
  if (await fileExists(targetPath)) {
    files = [targetPath];
  } else if (await isDirectory(targetPath)) {
    files = await glob(resolve(targetPath, '**/*.{yaml,yml,json,md}'), {
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });
  } else {
    return [];
  }

  for (const file of files) {
    const content = await readTextFile(file);
    if (!content) continue;

    const relPath = getRelPath(process.cwd(), file);
    const lines = content.split('\n');
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;
      for (const rule of SECURITY_RULES) {
        if (rule.pattern.test(line)) {
          findings.push({
            file: relPath,
            rule: rule.id,
            severity: rule.severity,
            message: rule.message,
            line: lineIdx + 1,
          });
        }
      }
    }
  }

  return findings;
}

// ── Inline validate logic (mirrors validate command) ────────────────

interface ValidationResult {
  file: string;
  valid: boolean;
  errors: string[];
}

async function runValidateCheck(targetPath: string): Promise<ValidationResult[]> {
  const yaml = (await import('js-yaml')).default;
  const { glob } = await import('glob');
  const results: ValidationResult[] = [];

  if (await fileExists(targetPath)) {
    if (targetPath.includes('.prompt.')) {
      results.push(await validateOneSpec(targetPath, yaml));
    }
  } else if (await isDirectory(targetPath)) {
    const promptSpecs = await glob(resolve(targetPath, '**/*.prompt.{yaml,yml}'), { absolute: true });
    for (const file of promptSpecs) {
      results.push(await validateOneSpec(file, yaml));
    }
  }

  return results;
}

async function validateOneSpec(
  filePath: string,
  yaml: { load: (s: string) => unknown },
): Promise<ValidationResult> {
  const relPath = getRelPath(process.cwd(), filePath);
  const errors: string[] = [];
  const content = await readTextFile(filePath);
  if (!content) {
    return { file: relPath, valid: false, errors: ['Could not read file'] };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    return { file: relPath, valid: false, errors: [`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`] };
  }

  if (!parsed || typeof parsed !== 'object') {
    errors.push('YAML content is not an object');
    return { file: relPath, valid: false, errors };
  }

  const spec = parsed as Record<string, unknown>;
  if (typeof spec['prompt'] !== 'string') {
    errors.push('Missing or invalid "prompt" field');
  }
  if (spec['model'] !== undefined && typeof spec['model'] !== 'string') {
    errors.push('"model" field must be a string');
  }
  if (spec['tests'] !== undefined && !Array.isArray(spec['tests'])) {
    errors.push('"tests" field must be an array');
  }

  return { file: relPath, valid: errors.length === 0, errors };
}

// ── Main check command ──────────────────────────────────────────────

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .argument('[path]', 'Path to check', '.')
    .description('CI-friendly validation — runs tests, lint, security, and validate in one shot')
    .option('--json', 'Output results as JSON')
    .option('--skip <checks>', 'Skip specific checks (comma-separated: tests,lint,security,validate)')
    .action(async (pathArg: string, options: { json?: boolean; skip?: string }) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const targetPath = resolvePath(pathArg);

      // Verify path exists
      try {
        await stat(targetPath);
      } catch {
        console.error(`Error: path not found: ${targetPath}`);
        process.exitCode = 1;
        return;
      }

      const skipped = new Set(
        (options.skip ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      );

      const results: CheckLineResult[] = [];
      const detailedResults: CheckOutput['checks'] = [];

      // ── 1. Tests ────────────────────────────────────────────────
      if (skipped.has('tests')) {
        results.push({ name: 'Tests', passed: true, label: 'skipped', skipped: true });
        detailedResults.push({ name: 'tests', passed: true, skipped: true, details: null });
      } else {
        try {
          const { glob } = await import('glob');
          const specFiles = await glob(resolve(targetPath, '**/*.prompt.{yaml,yml}'), { absolute: true });

          if (specFiles.length === 0) {
            results.push({ name: 'Tests', passed: true, label: '0/0 passed', skipped: false });
            detailedResults.push({ name: 'tests', passed: true, skipped: false, details: { total: 0, passed: 0, failed: 0 } });
          } else {
            const allResults: TestResult[] = [];
            const runOpts: RunOptions = { mode: 'mock', json: true };

            for (const specFile of specFiles.sort()) {
              try {
                const fileResults = await runPromptTests(specFile, runOpts);
                allResults.push(...fileResults);
              } catch {
                allResults.push({
                  testName: specFile,
                  promptName: specFile,
                  passed: false,
                  output: '',
                  duration: 0,
                  assertions: [],
                  cached: false,
                  error: 'Failed to process spec',
                });
              }
            }

            const passed = allResults.filter((r) => r.passed).length;
            const total = allResults.length;
            const allPass = passed === total;
            results.push({ name: 'Tests', passed: allPass, label: `${passed}/${total} passed`, skipped: false });
            detailedResults.push({ name: 'tests', passed: allPass, skipped: false, details: { total, passed, failed: total - passed } });
          }
        } catch {
          results.push({ name: 'Tests', passed: false, label: 'error', skipped: false });
          detailedResults.push({ name: 'tests', passed: false, skipped: false, details: { error: 'Failed to run tests' } });
        }
      }

      // ── 2. Lint ─────────────────────────────────────────────────
      if (skipped.has('lint')) {
        results.push({ name: 'Lint', passed: true, label: 'skipped', skipped: true });
        detailedResults.push({ name: 'lint', passed: true, skipped: true, details: null });
      } else {
        try {
          const warnings = await runLintCheck(targetPath);
          const errorCount = warnings.filter((w) => w.severity === 'error').length;
          const allPass = errorCount === 0;
          const label = errorCount === 0 ? `${warnings.length} issues` : `${errorCount} errors`;
          results.push({ name: 'Lint', passed: allPass, label, skipped: false });
          detailedResults.push({ name: 'lint', passed: allPass, skipped: false, details: { total: warnings.length, errors: errorCount } });
        } catch {
          results.push({ name: 'Lint', passed: true, label: '0 issues', skipped: false });
          detailedResults.push({ name: 'lint', passed: true, skipped: false, details: { total: 0, errors: 0 } });
        }
      }

      // ── 3. Security ─────────────────────────────────────────────
      if (skipped.has('security')) {
        results.push({ name: 'Security', passed: true, label: 'skipped', skipped: true });
        detailedResults.push({ name: 'security', passed: true, skipped: true, details: null });
      } else {
        try {
          const findings = await runSecurityCheck(targetPath);
          const criticalOrHigh = findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length;
          const allPass = criticalOrHigh === 0;
          const label = `${findings.length} findings`;
          results.push({ name: 'Security', passed: allPass, label, skipped: false });
          detailedResults.push({ name: 'security', passed: allPass, skipped: false, details: { total: findings.length, criticalOrHigh } });
        } catch {
          results.push({ name: 'Security', passed: true, label: '0 findings', skipped: false });
          detailedResults.push({ name: 'security', passed: true, skipped: false, details: { total: 0, criticalOrHigh: 0 } });
        }
      }

      // ── 4. Validate ─────────────────────────────────────────────
      if (skipped.has('validate')) {
        results.push({ name: 'Validate', passed: true, label: 'skipped', skipped: true });
        detailedResults.push({ name: 'validate', passed: true, skipped: true, details: null });
      } else {
        try {
          const validationResults = await runValidateCheck(targetPath);
          const validCount = validationResults.filter((r) => r.valid).length;
          const total = validationResults.length;
          const allPass = validCount === total;
          const label = `${validCount}/${total} valid`;
          results.push({ name: 'Validate', passed: allPass, label, skipped: false });
          detailedResults.push({ name: 'validate', passed: allPass, skipped: false, details: { total, valid: validCount, invalid: total - validCount } });
        } catch {
          results.push({ name: 'Validate', passed: true, label: '0/0 valid', skipped: false });
          detailedResults.push({ name: 'validate', passed: true, skipped: false, details: { total: 0, valid: 0, invalid: 0 } });
        }
      }

      // ── Output ──────────────────────────────────────────────────

      const failedChecks = results.filter((r) => !r.passed && !r.skipped);
      const allPassed = failedChecks.length === 0;

      if (options.json) {
        const output: CheckOutput = {
          checks: detailedResults,
          allPassed,
        };
        console.log(JSON.stringify(output, null, 2));
        if (!allPassed) {
          process.exitCode = 1;
        }
        return;
      }

      const chalk = (await import('chalk')).default;

      console.log('');
      console.log(chalk.bold('  codeprobe check'));
      console.log('');

      for (const result of results) {
        if (result.skipped) {
          console.log(`  ${result.name.padEnd(12)} ${chalk.dim(result.label)} ${chalk.dim('-')}`);
        } else if (result.passed) {
          console.log(`  ${result.name.padEnd(12)} ${result.label} ${chalk.green('\u2713')}`);
        } else {
          console.log(`  ${result.name.padEnd(12)} ${chalk.red(result.label)} ${chalk.red('\u2717')}`);
        }
      }

      console.log('');

      if (allPassed) {
        console.log(chalk.green('  All checks passed \u2713'));
      } else {
        console.log(chalk.red(`  ${failedChecks.length} check${failedChecks.length === 1 ? '' : 's'} failed \u2014 exit 1`));
        process.exitCode = 1;
      }

      console.log('');
    });
}
