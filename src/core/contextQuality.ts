/**
 * Context quality scoring — evaluates a repository's readiness for AI tools.
 *
 * All scoring is offline (no API calls). Produces a 0-100 score with an A-F
 * grade across six criteria: signal-to-noise, file diversity, documentation
 * coverage, redundancy, context window utilization, and AI tool readiness.
 */

import { readFile } from 'node:fs/promises';
import { resolve, basename, dirname } from 'node:path';
import { walkDirectory } from '../utils/fs.js';
import { estimateTokens } from '../tokenizers/claudeTokenizer.js';
import type { CodeprobeConfig } from '../types/config.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ContextQualityCriterion {
  name: string;
  score: number;   // 0-100
  weight: number;  // 0-1
  details: string;
}

export interface ContextQualityReport {
  overallScore: number;    // 0-100
  grade: string;           // A-F
  criteria: ContextQualityCriterion[];
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '__pycache__', '.venv', 'vendor',
  '.cache', '.turbo',
]);

/** Extensions that are generated/lock files, not core source. */
const GENERATED_EXTENSIONS = new Set([
  '.lock', '.min.js', '.min.css', '.map',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.zip', '.tar', '.gz',
  '.pyc', '.pyo', '.class',
]);

/** Lock/generated filenames. */
const GENERATED_FILENAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'composer.lock', 'Gemfile.lock', 'Cargo.lock',
  'poetry.lock', 'Pipfile.lock',
  '.DS_Store', 'Thumbs.db',
]);

/** Core source code extensions. */
const CORE_SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift',
  '.sql', '.graphql', '.gql',
  '.sh', '.bash', '.zsh',
]);

/** AI tool config files. */
const AI_CONFIG_FILES = new Set([
  'claude.md', '.cursorrules', '.cursorignore',
  'copilot-instructions.md', '.github/copilot-instructions.md',
  '.aider.conf.yml', '.continue/config.json',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gradeFromScore(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

// ---------------------------------------------------------------------------
// Criterion 1: Signal-to-noise ratio (weight 0.25)
// ---------------------------------------------------------------------------

interface FileInfo {
  path: string;
  relativePath: string;
  size: number;
  extension: string;
  isCore: boolean;
  isGenerated: boolean;
  tokens: number;
}

async function gatherFileInfo(
  rootPath: string,
  ignoreDirs: Set<string>,
): Promise<FileInfo[]> {
  const entries = await walkDirectory(rootPath, { ignoreDirs });
  const files: FileInfo[] = [];

  for (const entry of entries) {
    if (!entry.isFile) continue;
    if (entry.size > 1_000_000) continue; // skip very large files

    const name = basename(entry.path).toLowerCase();
    const ext = entry.extension;

    const isGenerated = GENERATED_EXTENSIONS.has(ext) || GENERATED_FILENAMES.has(name);
    const isCore = CORE_SOURCE_EXTENSIONS.has(ext);

    let tokens = 0;
    if (!isGenerated && entry.size < 500_000) {
      try {
        const content = await readFile(entry.path, 'utf-8');
        tokens = estimateTokens(content);
      } catch {
        // skip unreadable files
      }
    }

    files.push({
      path: entry.path,
      relativePath: entry.relativePath,
      size: entry.size,
      extension: ext,
      isCore,
      isGenerated,
      tokens,
    });
  }

  return files;
}

function scoreSignalToNoise(files: FileInfo[]): ContextQualityCriterion {
  const totalTokens = files.reduce((sum, f) => sum + f.tokens, 0);
  const coreTokens = files.filter((f) => f.isCore).reduce((sum, f) => sum + f.tokens, 0);

  if (totalTokens === 0) {
    return {
      name: 'Signal-to-Noise',
      score: 50,
      weight: 0.25,
      details: 'No readable files found',
    };
  }

  const ratio = coreTokens / totalTokens;
  let score: number;
  if (ratio >= 0.8) score = 100;
  else if (ratio >= 0.6) score = 75;
  else if (ratio >= 0.4) score = 50;
  else score = 25;

  return {
    name: 'Signal-to-Noise',
    score,
    weight: 0.25,
    details: `${Math.round(ratio * 100)}% of tokens are core source code (${coreTokens} / ${totalTokens})`,
  };
}

// ---------------------------------------------------------------------------
// Criterion 2: File diversity (weight 0.15)
// ---------------------------------------------------------------------------

function scoreFileDiversity(files: FileInfo[]): ContextQualityCriterion {
  const dirs = new Set<string>();
  for (const f of files) {
    if (f.isCore) {
      const dir = dirname(f.relativePath);
      dirs.add(dir);
    }
  }

  const dirCount = dirs.size;
  let score: number;
  if (dirCount > 5) score = 100;
  else if (dirCount >= 3) score = 75;
  else score = 50;

  return {
    name: 'File Diversity',
    score,
    weight: 0.15,
    details: `Source files span ${dirCount} director${dirCount === 1 ? 'y' : 'ies'}`,
  };
}

// ---------------------------------------------------------------------------
// Criterion 3: Documentation coverage (weight 0.15)
// ---------------------------------------------------------------------------

function scoreDocumentation(files: FileInfo[]): ContextQualityCriterion {
  let hasReadme = false;
  let hasAiConfig = false;

  for (const f of files) {
    const name = basename(f.path).toLowerCase();
    if (name.startsWith('readme')) hasReadme = true;
    if (AI_CONFIG_FILES.has(name)) hasAiConfig = true;
    // Also check for CLAUDE.md specifically
    if (name === 'claude.md') hasAiConfig = true;
  }

  let score: number;
  if (hasReadme && hasAiConfig) score = 100;
  else if (hasReadme || hasAiConfig) score = 60;
  else score = 20;

  const found: string[] = [];
  if (hasReadme) found.push('README');
  if (hasAiConfig) found.push('AI config');

  return {
    name: 'Documentation',
    score,
    weight: 0.15,
    details: found.length > 0
      ? `Found: ${found.join(', ')}`
      : 'No README or AI config files found',
  };
}

// ---------------------------------------------------------------------------
// Criterion 4: Redundancy (weight 0.15)
// ---------------------------------------------------------------------------

function scoreRedundancy(files: FileInfo[]): ContextQualityCriterion {
  // Check for files with the same base name in different directories
  const nameMap = new Map<string, string[]>();
  for (const f of files) {
    if (!f.isCore) continue;
    const name = basename(f.path);
    const existing = nameMap.get(name);
    if (existing) {
      existing.push(f.relativePath);
    } else {
      nameMap.set(name, [f.relativePath]);
    }
  }

  const duplicateNames = Array.from(nameMap.values()).filter((paths) => paths.length > 1);

  // Check for .js + .ts pairs (compiled output left alongside source)
  let jsTsPairs = 0;
  const tsFiles = new Set(
    files.filter((f) => f.extension === '.ts' || f.extension === '.tsx')
      .map((f) => f.relativePath.replace(/\.tsx?$/, '')),
  );
  for (const f of files) {
    if (f.extension === '.js' || f.extension === '.jsx') {
      const base = f.relativePath.replace(/\.jsx?$/, '');
      if (tsFiles.has(base)) {
        jsTsPairs++;
      }
    }
  }

  const totalRedundancies = duplicateNames.length + jsTsPairs;
  let score: number;
  if (totalRedundancies === 0) score = 100;
  else if (totalRedundancies <= 3) score = 60;
  else score = 30;

  const details: string[] = [];
  if (duplicateNames.length > 0) details.push(`${duplicateNames.length} duplicate filename(s)`);
  if (jsTsPairs > 0) details.push(`${jsTsPairs} .js/.ts pair(s)`);

  return {
    name: 'Redundancy',
    score,
    weight: 0.15,
    details: details.length > 0
      ? details.join(', ')
      : 'No redundant files detected',
  };
}

// ---------------------------------------------------------------------------
// Criterion 5: Context window utilization (weight 0.15)
// ---------------------------------------------------------------------------

function scoreWindowUtilization(files: FileInfo[]): ContextQualityCriterion {
  const totalTokens = files.reduce((sum, f) => sum + f.tokens, 0);

  let score: number;
  let details: string;

  if (totalTokens <= 150_000) {
    score = 100;
    details = `${totalTokens} tokens — fits 200k window with room to spare`;
  } else if (totalTokens <= 200_000) {
    score = 75;
    details = `${totalTokens} tokens — fits 200k window tightly`;
  } else if (totalTokens <= 1_000_000) {
    score = 50;
    details = `${totalTokens} tokens — requires 1M context window`;
  } else {
    score = 25;
    details = `${totalTokens} tokens — exceeds even 1M context window`;
  }

  return {
    name: 'Window Utilization',
    score,
    weight: 0.15,
    details,
  };
}

// ---------------------------------------------------------------------------
// Criterion 6: AI tool readiness (weight 0.15)
// ---------------------------------------------------------------------------

function scoreAiToolReadiness(files: FileInfo[]): ContextQualityCriterion {
  let hasClaudeMd = false;
  let hasCursorRules = false;
  let hasCopilotInstructions = false;
  let hasOtherAiConfig = false;

  for (const f of files) {
    const name = basename(f.path).toLowerCase();
    const relLower = f.relativePath.toLowerCase();

    if (name === 'claude.md') hasClaudeMd = true;
    if (name === '.cursorrules') hasCursorRules = true;
    if (name === 'copilot-instructions.md' || relLower.includes('copilot-instructions')) {
      hasCopilotInstructions = true;
    }
    if (name === '.aider.conf.yml' || relLower.includes('.continue/config')) {
      hasOtherAiConfig = true;
    }
  }

  const aiConfigs: string[] = [];
  if (hasClaudeMd) aiConfigs.push('CLAUDE.md');
  if (hasCursorRules) aiConfigs.push('.cursorrules');
  if (hasCopilotInstructions) aiConfigs.push('copilot-instructions.md');
  if (hasOtherAiConfig) aiConfigs.push('other AI config');

  let score: number;
  if (aiConfigs.length >= 2) score = 100;
  else if (aiConfigs.length === 1) score = 60;
  else score = 20;

  return {
    name: 'AI Tool Readiness',
    score,
    weight: 0.15,
    details: aiConfigs.length > 0
      ? `Found: ${aiConfigs.join(', ')}`
      : 'No AI tool configuration files found',
  };
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

function generateRecommendations(
  criteria: ContextQualityCriterion[],
  files: FileInfo[],
): string[] {
  const recommendations: string[] = [];

  for (const c of criteria) {
    if (c.name === 'Signal-to-Noise' && c.score < 75) {
      const generatedCount = files.filter((f) => f.isGenerated).length;
      if (generatedCount > 0) {
        recommendations.push(
          `Exclude ${generatedCount} generated/lock file(s) from context to improve signal-to-noise ratio`,
        );
      }
    }

    if (c.name === 'File Diversity' && c.score < 75) {
      recommendations.push(
        'Organize source code into more directories to improve navigability',
      );
    }

    if (c.name === 'Documentation' && c.score < 100) {
      if (!c.details.includes('README')) {
        recommendations.push('Add a README.md for project documentation');
      }
      if (!c.details.includes('AI config')) {
        recommendations.push(
          'Add a CLAUDE.md or .cursorrules for better AI tool integration',
        );
      }
    }

    if (c.name === 'Redundancy' && c.score < 100) {
      recommendations.push(
        'Review duplicate filenames and .js/.ts pairs — consider removing redundant files',
      );
    }

    if (c.name === 'Window Utilization' && c.score < 75) {
      // Find files larger than 5k tokens
      const largeFiles = files.filter((f) => f.tokens > 5000);
      if (largeFiles.length > 0) {
        recommendations.push(
          `Consider splitting large files (${largeFiles.length} file(s) > 5k tokens each)`,
        );
      }
    }

    if (c.name === 'AI Tool Readiness' && c.score < 100) {
      recommendations.push(
        'Add more AI tool config files (CLAUDE.md, .cursorrules) for broader tool support',
      );
    }
  }

  return recommendations;
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

/**
 * Score the context quality of a repository at the given path.
 *
 * Criteria and weights:
 *   1. Signal-to-noise ratio  (0.25)
 *   2. File diversity          (0.15)
 *   3. Documentation coverage  (0.15)
 *   4. Redundancy              (0.15)
 *   5. Window utilization      (0.15)
 *   6. AI tool readiness       (0.15)
 */
export async function scoreContextQuality(
  rootPath: string,
  _config?: CodeprobeConfig,
): Promise<ContextQualityReport> {
  const absolutePath = resolve(rootPath);

  // Build ignore set
  const ignoreDirs = new Set(DEFAULT_IGNORE_DIRS);

  // Gather file information
  const files = await gatherFileInfo(absolutePath, ignoreDirs);

  // Score each criterion
  const criteria: ContextQualityCriterion[] = [
    scoreSignalToNoise(files),
    scoreFileDiversity(files),
    scoreDocumentation(files),
    scoreRedundancy(files),
    scoreWindowUtilization(files),
    scoreAiToolReadiness(files),
  ];

  // Weighted average
  const weightedSum = criteria.reduce((sum, c) => sum + c.score * c.weight, 0);
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  const overallScore = Math.round(weightedSum / totalWeight);

  // Generate recommendations
  const recommendations = generateRecommendations(criteria, files);

  return {
    overallScore,
    grade: gradeFromScore(overallScore),
    criteria,
    recommendations,
  };
}
