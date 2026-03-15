/**
 * Security scanner for prompt specification files.
 *
 * Checks prompt files for common security vulnerabilities including
 * prompt injection, unsafe interpolation, secret leakage, dangerous
 * permission grants, and instruction override patterns.
 */

import { extname } from 'node:path';
import { stat } from 'node:fs/promises';
import type { SecurityFinding } from '../types/diagnostics.js';
import { walkDirectory, readTextFile } from '../utils/fs.js';

/** Directories to skip during traversal. */
const SKIP_DIRS: Set<string> = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '__pycache__', '.next', '.nuxt', '.cache', '.turbo',
  '.parcel-cache', '.vscode', '.idea', 'vendor', 'tmp',
  '.tmp', '.terraform',
]);

/** File extensions to scan. */
const SCANNABLE_EXTENSIONS = new Set([
  '.yaml', '.yml', '.json', '.md', '.txt',
  '.ts', '.js', '.mjs', '.cjs',
  '.prompt', '.template',
]);

/**
 * A security rule definition.
 */
interface SecurityRule {
  id: string;
  severity: SecurityFinding['severity'];
  patterns: ReadonlyArray<RegExp>;
  message: string;
}

/**
 * Security rules for prompt injection detection.
 */
const INJECTION_RULES: ReadonlyArray<SecurityRule> = [
  {
    id: 'prompt-injection',
    severity: 'critical',
    patterns: [
      /ignore\s+(all\s+)?previous\s+instructions/i,
      /disregard\s+(all\s+)?(previous|above|prior)\s+(instructions|context|rules)/i,
      /forget\s+(all\s+)?(previous|above|prior)/i,
      /you\s+are\s+now\s+a\s+/i,
      /new\s+role\s*:/i,
      /from\s+now\s+on\s*,?\s+(you|ignore|disregard)/i,
      /system\s*:\s*you\s+are/i,
    ],
    message: 'Potential prompt injection pattern detected. This text could be used to override system instructions.',
  },
];

/**
 * Security rules for unsafe interpolation detection.
 */
const INTERPOLATION_RULES: ReadonlyArray<SecurityRule> = [
  {
    id: 'unsafe-interpolation',
    severity: 'high',
    patterns: [
      /\$\{[^}]*\}/,         // JavaScript template literals
      /\{\{[^}]*\}\}/,       // Mustache/Handlebars
      /\{%[^%]*%\}/,         // Jinja2
      /<%[^%]*%>/,           // ERB
      /\$\{[^}]{0,100}user[^}]{0,100}\}/i,     // User input in template
      /\{\{[^}]{0,100}input[^}]{0,100}\}\}/i,  // Input in template
    ],
    message: 'Template interpolation detected without apparent sanitization. User input could be injected into the prompt.',
  },
];

/**
 * Security rules for secret leakage detection.
 */
const SECRET_RULES: ReadonlyArray<SecurityRule> = [
  {
    id: 'secret-leakage',
    severity: 'critical',
    patterns: [
      /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[a-zA-Z0-9_\-]{20,}/i,
      /(?:secret|token|password|passwd|pwd)\s*[:=]\s*["']?[a-zA-Z0-9_\-]{8,}/i,
      /sk-[a-zA-Z0-9]{20,}/,             // OpenAI/Anthropic key format
      /ghp_[a-zA-Z0-9]{36}/,             // GitHub personal access token
      /gho_[a-zA-Z0-9]{36}/,             // GitHub OAuth token
      /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/,  // Bearer tokens
      /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/, // PEM private keys
      /AKIA[0-9A-Z]{16}/,                // AWS access key ID
    ],
    message: 'Possible secret or credential found in prompt file. Never embed secrets directly in prompts.',
  },
];

/**
 * Security rules for dangerous permission structures.
 */
const DANGEROUS_STRUCTURE_RULES: ReadonlyArray<SecurityRule> = [
  {
    id: 'dangerous-structure',
    severity: 'high',
    patterns: [
      /you\s+(can|may|have|are\s+allowed\s+to)\s+[\s\S]{0,100}?\b(execute|run|eval|delete|drop|rm\s+-rf)\b/i,
      /full\s+access\s+to/i,
      /unrestricted\s+access/i,
      /no\s+restrictions/i,
      /you\s+have\s+root\s+access/i,
      /you\s+can\s+do\s+anything/i,
      /admin(istrator)?\s+privileges/i,
      /bypass\s+(all\s+)?(security|restrictions|limits|filters)/i,
    ],
    message: 'System prompt grants excessive permissions. Restrict capabilities to only what is necessary.',
  },
];

/**
 * Security rules for instruction override patterns.
 */
const OVERRIDE_RULES: ReadonlyArray<SecurityRule> = [
  {
    id: 'instruction-override',
    severity: 'high',
    patterns: [
      /override\s+(all\s+)?(system|previous|prior)\s+(instructions|rules|constraints)/i,
      /replace\s+(the\s+)?(system|previous)\s+(prompt|instructions)/i,
      /the\s+following\s+instructions?\s+(supersede|override|replace)/i,
      /above\s+instructions?\s+(are|is)\s+(no\s+longer|void|invalid|overridden)/i,
      /new\s+system\s+prompt/i,
      /updated?\s+instructions?\s*:/i,
    ],
    message: 'Pattern that attempts to override or replace system instructions detected.',
  },
];

/** All rule categories. */
const ALL_RULES: ReadonlyArray<SecurityRule> = [
  ...INJECTION_RULES,
  ...INTERPOLATION_RULES,
  ...SECRET_RULES,
  ...DANGEROUS_STRUCTURE_RULES,
  ...OVERRIDE_RULES,
];

/**
 * Scan a single file's content against all security rules.
 */
function scanContent(
  filePath: string,
  content: string,
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split('\n');

  for (const rule of ALL_RULES) {
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]!;

      for (const pattern of rule.patterns) {
        const match = pattern.exec(line);
        if (match) {
          // Avoid duplicate findings for the same rule on the same line
          const alreadyFound = findings.some(
            (f) =>
              f.file === filePath &&
              f.rule === rule.id &&
              f.line === lineIndex + 1,
          );

          if (!alreadyFound) {
            // Create a snippet with some context
            const snippetStart = Math.max(0, match.index - 20);
            const snippetEnd = Math.min(line.length, match.index + match[0].length + 20);
            const snippet = line.slice(snippetStart, snippetEnd).trim();

            findings.push({
              file: filePath,
              rule: rule.id,
              severity: rule.severity,
              message: rule.message,
              line: lineIndex + 1,
              snippet: snippet.length > 100 ? snippet.slice(0, 97) + '...' : snippet,
            });
          }

          break; // Only report first pattern match per rule per line
        }
      }
    }
  }

  return findings;
}

/**
 * Scan a repository's prompt files for security issues.
 *
 * Checks for:
 * 1. `prompt-injection`: Patterns that override or ignore previous instructions
 * 2. `unsafe-interpolation`: Template patterns without sanitization
 * 3. `secret-leakage`: API keys, tokens, passwords embedded in prompts
 * 4. `dangerous-structure`: System prompts granting excessive permissions
 * 5. `instruction-override`: Patterns that replace system instructions
 *
 * @param rootPath  Absolute path to the repository root.
 * @returns         Array of security findings sorted by severity.
 */
export async function scanSecurity(
  rootPath: string,
): Promise<SecurityFinding[]> {
  // Verify root exists
  try {
    const rootStat = await stat(rootPath);
    if (!rootStat.isDirectory()) return [];
  } catch {
    return [];
  }

  const findings: SecurityFinding[] = [];

  const entries = await walkDirectory(rootPath, { ignoreDirs: SKIP_DIRS });

  for (const entry of entries) {
    if (!entry.isFile) continue;
    const ext = extname(entry.path).toLowerCase();
    if (!SCANNABLE_EXTENSIONS.has(ext)) continue;

    const content = await readTextFile(entry.path);
    if (!content) continue;

    const fileFindings = scanContent(entry.path, content);
    findings.push(...fileFindings);
  }

  // Sort by severity: critical > high > medium > low
  const severityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  findings.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return a.file.localeCompare(b.file);
  });

  return findings;
}
