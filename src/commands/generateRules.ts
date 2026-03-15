/**
 * `claude-test generate-rules [path]` — Generate AI tool config files
 * for Cursor (.cursorrules), Windsurf (.windsurfrules), and GitHub Copilot
 * (.github/copilot-instructions.md) based on repository analysis.
 *
 * Detects tech stack, reads existing CLAUDE.md if present, and produces
 * config files that help each AI tool understand the project.
 */

import { Command } from 'commander';
import { stat, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename, dirname } from 'node:path';
import { analyzeContext } from '../core/contextAnalyzer.js';
import { readTextFile, fileExists } from '../utils/fs.js';
import { resolvePath } from '../utils/paths.js';
import { formatTokens } from '../utils/output.js';

// -----------------------------------------------------------------------
// Tech stack detection (shared with generateClaudeMd)
// -----------------------------------------------------------------------

interface TechIndicator {
  file: string;
  tech: string;
}

const TECH_INDICATORS: ReadonlyArray<TechIndicator> = [
  { file: 'package.json', tech: 'Node.js / TypeScript / JavaScript' },
  { file: 'go.mod', tech: 'Go' },
  { file: 'requirements.txt', tech: 'Python' },
  { file: 'pyproject.toml', tech: 'Python' },
  { file: 'Cargo.toml', tech: 'Rust' },
  { file: 'pom.xml', tech: 'Java' },
  { file: 'build.gradle', tech: 'Java' },
  { file: 'Gemfile', tech: 'Ruby' },
  { file: 'mix.exs', tech: 'Elixir' },
];

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Detect technologies present in the target directory.
 */
async function detectTechStack(targetPath: string): Promise<string[]> {
  const detected: string[] = [];
  const seen = new Set<string>();

  for (const indicator of TECH_INDICATORS) {
    const indicatorPath = resolve(targetPath, indicator.file);
    if (await fileExists(indicatorPath)) {
      if (!seen.has(indicator.tech)) {
        seen.add(indicator.tech);
        detected.push(indicator.tech);
      }
    }
  }

  // Check for .csproj files
  const { walkDirectory } = await import('../utils/fs.js');
  const entries = await walkDirectory(targetPath, {
    ignoreDirs: new Set([
      'node_modules', '.git', 'dist', 'build', 'coverage',
      '__pycache__', '.next', '.nuxt', 'vendor', '.venv',
    ]),
  });

  const hasCsproj = entries.some(
    (e) => e.isFile && e.extension === '.csproj',
  );
  if (hasCsproj && !seen.has('.NET / C#')) {
    detected.push('.NET / C#');
  }

  return detected;
}

interface PackageInfo {
  name: string;
  description: string;
}

/**
 * Read project name and description from package.json if it exists.
 */
async function readPackageJson(
  targetPath: string,
): Promise<PackageInfo | null> {
  const pkgPath = resolve(targetPath, 'package.json');
  const content = await readTextFile(pkgPath);
  if (content === null) return null;

  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null) {
      const pkg = parsed as Record<string, unknown>;
      return {
        name: typeof pkg['name'] === 'string' ? pkg['name'] : '',
        description:
          typeof pkg['description'] === 'string' ? pkg['description'] : '',
      };
    }
  } catch {
    // Invalid JSON — ignore
  }

  return null;
}

/**
 * Build directory structure summary from walk entries.
 */
function buildDirectoryLines(
  entries: Array<{
    relativePath: string;
    isFile: boolean;
  }>,
): string[] {
  const dirCounts = new Map<string, number>();

  for (const entry of entries) {
    if (!entry.isFile) continue;
    const parts = entry.relativePath.split(/[/\\]/);
    const topDir = parts.length > 1 ? parts[0]! : '(root)';
    dirCounts.set(topDir, (dirCounts.get(topDir) ?? 0) + 1);
  }

  const sorted = Array.from(dirCounts.entries()).sort(
    (a, b) => b[1] - a[1],
  );

  if (sorted.length === 0) return ['(no files found)'];

  const lines: string[] = [];
  for (const [dir, count] of sorted.slice(0, 10)) {
    lines.push(`${dir}/ — ${count} file${count === 1 ? '' : 's'}`);
  }
  if (sorted.length > 10) {
    lines.push(`...and ${sorted.length - 10} more directories`);
  }

  return lines;
}

// -----------------------------------------------------------------------
// Supported tools
// -----------------------------------------------------------------------

type ToolName = 'cursor' | 'windsurf' | 'copilot';

const ALL_TOOLS: ReadonlyArray<ToolName> = ['cursor', 'windsurf', 'copilot'];

interface RulesData {
  projectName: string;
  techStack: string[];
  directoryLines: string[];
  topFiles: Array<{ path: string; estimatedTokens: number }>;
  totalTokens: number;
  coreDirs: string[];
  claudeMdContent: string | null;
  codingGuidelines: string[];
}

/**
 * Infer language-specific coding guidelines from the detected tech stack.
 */
function inferCodingGuidelines(techStack: string[]): string[] {
  const guidelines: string[] = [
    'Follow existing code style and patterns',
  ];

  const techSet = new Set(techStack.map((t) => t.toLowerCase()));

  if (techSet.has('node.js / typescript / javascript')) {
    guidelines.push('Use TypeScript strict mode where applicable');
    guidelines.push('Prefer async/await over raw Promises');
    guidelines.push('Use ES module imports (import/export)');
  }
  if (techSet.has('python')) {
    guidelines.push('Follow PEP 8 style conventions');
    guidelines.push('Use type hints for function signatures');
  }
  if (techSet.has('go')) {
    guidelines.push('Follow standard Go formatting (gofmt)');
    guidelines.push('Handle errors explicitly — do not ignore returned errors');
  }
  if (techSet.has('rust')) {
    guidelines.push('Follow Rust idioms — use Result/Option, avoid unwrap in library code');
    guidelines.push('Run clippy and fix all warnings');
  }
  if (techSet.has('java')) {
    guidelines.push('Follow Java naming conventions (camelCase methods, PascalCase classes)');
  }
  if (techSet.has('ruby')) {
    guidelines.push('Follow Ruby community style guide conventions');
  }
  if (techSet.has('.net / c#')) {
    guidelines.push('Follow .NET naming conventions (PascalCase for public members)');
  }

  return guidelines;
}

/**
 * Identify core source directories from directory lines.
 */
function identifyCoreDirs(
  directoryLines: string[],
): string[] {
  const corePrefixes = ['src', 'lib', 'app', 'apps', 'packages', 'services', 'cmd', 'pkg', 'internal'];
  const dirs: string[] = [];

  for (const line of directoryLines) {
    const dirName = line.split('/')[0]!.trim();
    if (corePrefixes.includes(dirName.toLowerCase())) {
      dirs.push(dirName);
    }
  }

  return dirs.length > 0 ? dirs : directoryLines.slice(0, 3).map((l) => l.split('/')[0]!.trim());
}

// -----------------------------------------------------------------------
// Config file generators
// -----------------------------------------------------------------------

function generateCursorRules(data: RulesData): string {
  const lines: string[] = [];

  lines.push(`# Project: ${data.projectName}`);
  lines.push(`# Tech Stack: ${data.techStack.length > 0 ? data.techStack.join(', ') : 'Unknown'}`);
  lines.push('');

  // Include CLAUDE.md content as base if present
  if (data.claudeMdContent) {
    lines.push('## Project Context (from CLAUDE.md)');
    lines.push(data.claudeMdContent.trim());
    lines.push('');
  }

  lines.push('## Coding Guidelines');
  for (const guideline of data.codingGuidelines) {
    lines.push(`- ${guideline}`);
  }
  lines.push('');

  lines.push('## Project Structure');
  for (const dirLine of data.directoryLines) {
    lines.push(`- ${dirLine}`);
  }
  lines.push('');

  lines.push('## Important Files');
  const topCount = Math.min(5, data.topFiles.length);
  for (let i = 0; i < topCount; i++) {
    const f = data.topFiles[i]!;
    lines.push(`- ${f.path} (${formatTokens(f.estimatedTokens)} tokens)`);
  }
  if (data.topFiles.length === 0) {
    lines.push('- (no text files found)');
  }
  lines.push('');

  lines.push('## Context Budget');
  lines.push(`- Total tokens: ${formatTokens(data.totalTokens)}`);
  lines.push(`- Recommended focus: ${data.coreDirs.length > 0 ? data.coreDirs.join(', ') : 'all directories'}`);
  lines.push('');

  return lines.join('\n');
}

function generateWindsurfRules(data: RulesData): string {
  const lines: string[] = [];

  lines.push(`# Windsurf Project Rules`);
  lines.push(`# Project: ${data.projectName}`);
  lines.push(`# Tech Stack: ${data.techStack.length > 0 ? data.techStack.join(', ') : 'Unknown'}`);
  lines.push('');

  // Include CLAUDE.md content as base if present
  if (data.claudeMdContent) {
    lines.push('## Project Context (from CLAUDE.md)');
    lines.push(data.claudeMdContent.trim());
    lines.push('');
  }

  lines.push('## Coding Guidelines');
  for (const guideline of data.codingGuidelines) {
    lines.push(`- ${guideline}`);
  }
  lines.push('');

  lines.push('## Project Structure');
  for (const dirLine of data.directoryLines) {
    lines.push(`- ${dirLine}`);
  }
  lines.push('');

  lines.push('## Important Files');
  const topCount = Math.min(5, data.topFiles.length);
  for (let i = 0; i < topCount; i++) {
    const f = data.topFiles[i]!;
    lines.push(`- ${f.path} (${formatTokens(f.estimatedTokens)} tokens)`);
  }
  if (data.topFiles.length === 0) {
    lines.push('- (no text files found)');
  }
  lines.push('');

  lines.push('## Context Budget');
  lines.push(`- Total tokens: ${formatTokens(data.totalTokens)}`);
  lines.push(`- Recommended focus: ${data.coreDirs.length > 0 ? data.coreDirs.join(', ') : 'all directories'}`);
  lines.push('');

  return lines.join('\n');
}

function generateCopilotInstructions(data: RulesData): string {
  const lines: string[] = [];

  lines.push(`# ${data.projectName} — Copilot Instructions`);
  lines.push('');
  lines.push(`**Tech Stack:** ${data.techStack.length > 0 ? data.techStack.join(', ') : 'Unknown'}`);
  lines.push('');

  // Include CLAUDE.md content as base if present
  if (data.claudeMdContent) {
    lines.push('## Project Context (from CLAUDE.md)');
    lines.push('');
    lines.push(data.claudeMdContent.trim());
    lines.push('');
  }

  lines.push('## Coding Guidelines');
  lines.push('');
  for (const guideline of data.codingGuidelines) {
    lines.push(`- ${guideline}`);
  }
  lines.push('');

  lines.push('## Project Structure');
  lines.push('');
  for (const dirLine of data.directoryLines) {
    lines.push(`- ${dirLine}`);
  }
  lines.push('');

  lines.push('## Important Files');
  lines.push('');
  const topCount = Math.min(5, data.topFiles.length);
  for (let i = 0; i < topCount; i++) {
    const f = data.topFiles[i]!;
    lines.push(`- \`${f.path}\` — ${formatTokens(f.estimatedTokens)} tokens`);
  }
  if (data.topFiles.length === 0) {
    lines.push('- (no text files found)');
  }
  lines.push('');

  lines.push('## Context Budget');
  lines.push('');
  lines.push(`- **Total tokens:** ${formatTokens(data.totalTokens)}`);
  lines.push(`- **Recommended focus:** ${data.coreDirs.length > 0 ? data.coreDirs.join(', ') : 'all directories'}`);
  lines.push('');

  return lines.join('\n');
}

// -----------------------------------------------------------------------
// Core generation logic
// -----------------------------------------------------------------------

interface GeneratedFile {
  tool: ToolName;
  relativePath: string;
  content: string;
}

async function generateRulesFiles(
  targetPath: string,
  tools: ReadonlyArray<ToolName>,
): Promise<GeneratedFile[]> {
  const absolutePath = resolve(targetPath);
  const dirName = basename(absolutePath);

  // Run analysis in parallel
  const [analysis, techStack, pkgInfo] = await Promise.all([
    analyzeContext(absolutePath),
    detectTechStack(absolutePath),
    readPackageJson(absolutePath),
  ]);

  // Read existing CLAUDE.md if present
  const claudeMdPath = resolve(absolutePath, 'CLAUDE.md');
  const claudeMdContent = await readTextFile(claudeMdPath);

  // Walk directory for structure
  const { walkDirectory } = await import('../utils/fs.js');
  const allEntries = await walkDirectory(absolutePath, {
    ignoreDirs: new Set([
      'node_modules', '.git', 'dist', 'build', 'coverage',
      '__pycache__', '.next', '.nuxt', 'vendor', '.venv',
    ]),
  });

  const directoryLines = buildDirectoryLines(allEntries);
  const coreDirs = identifyCoreDirs(directoryLines);
  const codingGuidelines = inferCodingGuidelines(techStack);

  const projectName = pkgInfo?.name || dirName;

  const data: RulesData = {
    projectName,
    techStack,
    directoryLines,
    topFiles: analysis.largestFiles.slice(0, 5),
    totalTokens: analysis.estimatedTokens,
    coreDirs,
    claudeMdContent,
    codingGuidelines,
  };

  const results: GeneratedFile[] = [];

  for (const tool of tools) {
    switch (tool) {
      case 'cursor':
        results.push({
          tool: 'cursor',
          relativePath: '.cursorrules',
          content: generateCursorRules(data),
        });
        break;
      case 'windsurf':
        results.push({
          tool: 'windsurf',
          relativePath: '.windsurfrules',
          content: generateWindsurfRules(data),
        });
        break;
      case 'copilot':
        results.push({
          tool: 'copilot',
          relativePath: '.github/copilot-instructions.md',
          content: generateCopilotInstructions(data),
        });
        break;
    }
  }

  return results;
}

// -----------------------------------------------------------------------
// Command registration
// -----------------------------------------------------------------------

export function registerGenerateRulesCommand(program: Command): void {
  program
    .command('generate-rules [path]')
    .description(
      'Generate AI tool config files for Cursor, Windsurf, and GitHub Copilot',
    )
    .option(
      '--tool <tool>',
      'Which tool to generate for: cursor, windsurf, copilot, all',
      'all',
    )
    .option('--dry-run', 'Print to stdout instead of writing files')
    .option('--json', 'Output in JSON format')
    .action(
      async (
        pathArg: string | undefined,
        options: { tool?: string; dryRun?: boolean; json?: boolean },
      ) => {
        const targetPath = resolvePath(pathArg ?? '.');

        // Validate the target path exists and is a directory
        try {
          const s = await stat(targetPath);
          if (!s.isDirectory()) {
            console.error(`Error: not a directory: ${targetPath}`);
            process.exitCode = 1;
            return;
          }
        } catch {
          console.error(`Error: path not found: ${targetPath}`);
          process.exitCode = 1;
          return;
        }

        // Parse --tool option
        const toolArg = (options.tool ?? 'all').toLowerCase();
        let tools: ReadonlyArray<ToolName>;

        if (toolArg === 'all') {
          tools = ALL_TOOLS;
        } else if (['cursor', 'windsurf', 'copilot'].includes(toolArg)) {
          tools = [toolArg as ToolName];
        } else {
          console.error(
            `Error: unknown tool "${toolArg}". Must be one of: cursor, windsurf, copilot, all`,
          );
          process.exitCode = 1;
          return;
        }

        const chalk = (await import('chalk')).default;

        if (!options.dryRun && !options.json) {
          console.log(chalk.dim('Analyzing repository...'));
        }

        const files = await generateRulesFiles(targetPath, tools);

        // JSON output mode
        if (options.json) {
          const output = files.map((f) => ({
            tool: f.tool,
            path: f.relativePath,
            content: f.content,
          }));
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        // Dry-run mode: print to stdout
        if (options.dryRun) {
          for (const file of files) {
            console.log(chalk.bold.cyan(`--- ${file.relativePath} (${file.tool}) ---`));
            console.log(file.content);
          }
          return;
        }

        // Write files
        for (const file of files) {
          const outputPath = resolve(targetPath, file.relativePath);

          // Ensure parent directory exists (needed for .github/)
          const parentDir = dirname(outputPath);
          await mkdir(parentDir, { recursive: true });

          await writeFile(outputPath, file.content, 'utf-8');
          console.log(
            chalk.green(`${file.relativePath} written to ${outputPath}`),
          );
        }
      },
    );
}
