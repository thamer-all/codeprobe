/**
 * `claude-test security [path]` — Security checks on prompt specs
 * and configuration files.
 *
 * Detects potential prompt injection patterns, leaked secrets,
 * and unsafe configurations.
 */

import { Command } from 'commander';
import { resolve } from 'node:path';
import { resolvePath } from '../utils/paths.js';
import { readTextFile, isDirectory, fileExists, getRelativePath as getRelPath } from '../utils/fs.js';
import { setLogLevel } from '../utils/logger.js';
import type { SecurityFinding } from '../types/diagnostics.js';

/** Security check patterns. */
const SECURITY_RULES: Array<{
  id: string;
  pattern: RegExp;
  severity: SecurityFinding['severity'];
  message: string;
}> = [
  {
    id: 'injection-ignore',
    pattern: /ignore\s+(previous|above|all)\s+(instructions?|prompts?|rules?)/i,
    severity: 'critical',
    message: 'Potential prompt injection: instruction override pattern detected',
  },
  {
    id: 'injection-pretend',
    pattern: /pretend\s+(you\s+are|to\s+be|that)/i,
    severity: 'high',
    message: 'Potential prompt injection: persona override pattern detected',
  },
  {
    id: 'injection-system-override',
    pattern: /system\s*:\s*you\s+are\s+now/i,
    severity: 'critical',
    message: 'Potential system prompt override detected',
  },
  {
    id: 'leaked-api-key',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}/i,
    severity: 'critical',
    message: 'Potential API key detected in prompt spec',
  },
  {
    id: 'leaked-secret',
    pattern: /(?:secret|password|token|credential)\s*[:=]\s*['"][^'"]{8,}/i,
    severity: 'critical',
    message: 'Potential secret or credential detected',
  },
  {
    id: 'leaked-env-var',
    pattern: /(?:sk-|pk_|rk_|ghp_|gho_|github_pat_)[A-Za-z0-9_\-]{20,}/,
    severity: 'critical',
    message: 'Potential service token (Stripe, GitHub, etc.) detected',
  },
  {
    id: 'unsafe-eval',
    pattern: /eval\s*\(|exec\s*\(|Function\s*\(/,
    severity: 'high',
    message: 'Dynamic code execution detected — potential security risk',
  },
  {
    id: 'url-in-prompt',
    pattern: /https?:\/\/[^\s'"]+/,
    severity: 'low',
    message: 'URL found in prompt — verify it is intentional and safe',
  },
  {
    id: 'pii-email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    severity: 'medium',
    message: 'Email address found — may contain PII',
  },
  {
    id: 'excessive-permissions',
    pattern: /\b(sudo|root|admin|superuser)\b.*\b(access|permission|privilege)/i,
    severity: 'medium',
    message: 'Reference to elevated permissions detected',
  },
  {
    id: 'data-exfiltration',
    pattern: /send\s+(to|data|all|everything)\s+(to\s+)?https?:\/\//i,
    severity: 'high',
    message: 'Potential data exfiltration pattern detected',
  },
];

/**
 * Scan a file for security issues.
 */
function scanFileContent(
  content: string,
  filePath: string,
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;

    for (const rule of SECURITY_RULES) {
      if (rule.pattern.test(line)) {
        // Extract a snippet (trim to 100 chars)
        const snippet = line.trim().length > 100
          ? line.trim().slice(0, 97) + '...'
          : line.trim();

        findings.push({
          file: filePath,
          rule: rule.id,
          severity: rule.severity,
          message: rule.message,
          line: lineIdx + 1,
          snippet,
        });
      }
    }
  }

  return findings;
}

/**
 * Run security scanning on prompt specs.
 */
async function securityScanner(targetPath: string): Promise<SecurityFinding[]> {
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
    throw new Error(`Path not found: ${targetPath}`);
  }

  for (const file of files) {
    const content = await readTextFile(file);
    if (!content) continue;

    const relPath = getRelPath(process.cwd(), file);
    const fileFindings = scanFileContent(content, relPath);
    findings.push(...fileFindings);
  }

  // Sort by severity
  const severityOrder: Record<SecurityFinding['severity'], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return findings;
}

export function registerSecurityCommand(program: Command): void {
  program
    .command('security [path]')
    .description('Security checks — detect injection patterns, leaked secrets, unsafe configs')
    .option('--json', 'Output findings as JSON')
    .action(async (
      pathArg: string | undefined,
      options: { json?: boolean },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? 'prompts');

      const findings = await securityScanner(targetPath);

      if (options.json) {
        console.log(JSON.stringify(findings, null, 2));
        return;
      }

      if (findings.length === 0) {
        console.log(chalk.green('\nNo security issues found.\n'));
        return;
      }

      const severityColor: Record<SecurityFinding['severity'], (s: string) => string> = {
        critical: chalk.bgRed.white,
        high: chalk.red,
        medium: chalk.yellow,
        low: chalk.blue,
      };

      console.log(chalk.bold(`\nSecurity Findings (${findings.length})`));
      console.log('');

      // Group by file
      const grouped = new Map<string, SecurityFinding[]>();
      for (const f of findings) {
        const list = grouped.get(f.file) ?? [];
        list.push(f);
        grouped.set(f.file, list);
      }

      for (const [file, fileFindings] of grouped) {
        console.log(chalk.bold(`  ${file}`));
        for (const finding of fileFindings) {
          const sevLabel = severityColor[finding.severity](` ${finding.severity.toUpperCase()} `);
          const lineStr = finding.line ? `:${finding.line}` : '';
          console.log(`    ${sevLabel}  ${finding.rule}${lineStr}`);
          console.log(`           ${finding.message}`);
          if (finding.snippet) {
            console.log(chalk.dim(`           ${finding.snippet}`));
          }
        }
        console.log('');
      }

      // Summary
      const critCount = findings.filter((f) => f.severity === 'critical').length;
      const highCount = findings.filter((f) => f.severity === 'high').length;
      const medCount = findings.filter((f) => f.severity === 'medium').length;
      const lowCount = findings.filter((f) => f.severity === 'low').length;

      console.log(
        chalk.dim(`  ${critCount} critical, ${highCount} high, ${medCount} medium, ${lowCount} low\n`),
      );

      if (critCount > 0 || highCount > 0) {
        process.exitCode = 1;
      }
    });
}
