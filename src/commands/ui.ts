/**
 * `codeprobe ui [path]` — Launch an interactive web dashboard
 * showing context analysis, token heatmap, AI tool detection,
 * model registry, doctor checks, and workflow score.
 */

import { Command } from 'commander';
import { createServer } from 'node:http';
import { basename } from 'node:path';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { platform } from 'node:os';

import { resolvePath } from '../utils/paths.js';
import { analyzeContext } from '../core/contextAnalyzer.js';
import { scanForClaudeAssets } from '../core/agentTracer.js';
import { getAllModels } from '../core/modelRegistry.js';
import { runDiagnostics } from '../core/doctorRunner.js';
import { generateDashboard } from '../ui/dashboard.js';
import type { DashboardData } from '../ui/dashboard.js';

/**
 * Minimal workflow analysis — mirrors the core logic from the
 * workflow command without importing its private helpers.
 */
async function analyzeWorkflowLite(
  rootPath: string,
): Promise<{ score: number; maxScore: number; detected: string[]; missing: string[] }> {
  const { readdir, access } = await import('node:fs/promises');
  const { join } = await import('node:path');

  async function exists(p: string): Promise<boolean> {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  }

  const categories: Array<{ name: string; present: boolean }> = [];

  // Task tracking
  const taskFiles = ['tasks/todo.md', 'TODO.md', 'todo.md', 'tasks/TODO.md'];
  let hasTasks = false;
  for (const f of taskFiles) {
    if (await exists(join(rootPath, f))) {
      hasTasks = true;
      break;
    }
  }
  categories.push({ name: 'task tracking', present: hasTasks });

  // Lessons
  const lessonFiles = ['tasks/lessons.md', 'LESSONS.md', 'lessons.md'];
  let hasLessons = false;
  for (const f of lessonFiles) {
    if (await exists(join(rootPath, f))) {
      hasLessons = true;
      break;
    }
  }
  categories.push({ name: 'lessons', present: hasLessons });

  // Plans
  let hasPlans = await exists(join(rootPath, 'PLAN.md')) || await exists(join(rootPath, 'plan.md'));
  if (!hasPlans) {
    try {
      const planEntries = await readdir(join(rootPath, 'plans'));
      hasPlans = planEntries.some(
        (e: string) => e.endsWith('.md') || e.endsWith('.yaml') || e.endsWith('.yml'),
      );
    } catch {
      // plans/ does not exist
    }
  }
  categories.push({ name: 'plans', present: hasPlans });

  // AI config
  const aiFiles = [
    'CLAUDE.md', '.claude/settings.json', '.cursorrules',
    '.windsurfrules', '.aider.conf.yml', '.github/copilot-instructions.md',
    '.continuerules', '.clinerules', 'codex.md', 'AGENTS.md',
  ];
  let hasAI = false;
  for (const f of aiFiles) {
    if (await exists(join(rootPath, f))) {
      hasAI = true;
      break;
    }
  }
  categories.push({ name: 'AI config', present: hasAI });

  // CI integration
  const ciFiles = ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile', '.circleci/config.yml'];
  let hasCI = false;
  for (const f of ciFiles) {
    if (await exists(join(rootPath, f))) {
      hasCI = true;
      break;
    }
  }
  categories.push({ name: 'CI integration', present: hasCI });

  const detected = categories.filter((c) => c.present).map((c) => c.name);
  const missing = categories.filter((c) => !c.present).map((c) => c.name);

  return {
    score: detected.length,
    maxScore: categories.length,
    detected,
    missing,
  };
}

/**
 * Open a URL in the user's default browser.
 */
function openBrowser(url: string): void {
  const os = platform();
  // Use execFile with array args to avoid shell injection
  const cmd = os === 'darwin' ? 'open' : os === 'win32' ? 'cmd' : 'xdg-open';
  const args = os === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(cmd, args, () => {
    // ignore errors — browser may simply not be available
  });
}

export function registerUiCommand(program: Command): void {
  program
    .command('ui [path]')
    .description('Launch interactive web dashboard')
    .option('-p, --port <port>', 'Port number', '3333')
    .option('--no-open', 'Do not open browser automatically')
    .action(async (pathArg: string | undefined, options: { port: string; open: boolean }) => {
      const targetPath = resolvePath(pathArg ?? '.');
      const parsed = parseInt(options.port, 10);
      const port = (!isNaN(parsed) && parsed >= 1 && parsed <= 65535) ? parsed : 3333;

      // Validate path
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

      const chalk = (await import('chalk')).default;

      console.log(chalk.bold('\n  codeprobe dashboard\n'));
      console.log(chalk.dim(`  Analyzing ${targetPath} ...\n`));

      // Run all analyses in parallel
      const [contextResult, assets, models, doctor, workflow] =
        await Promise.all([
          analyzeContext(targetPath),
          scanForClaudeAssets(targetPath),
          Promise.resolve(getAllModels()),
          runDiagnostics(),
          analyzeWorkflowLite(targetPath),
        ]);

      const projectName = basename(targetPath);

      const dashboardData: DashboardData = {
        projectName,
        projectPath: targetPath,
        generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        context: {
          totalFiles: contextResult.totalFiles,
          textFiles: contextResult.textFiles,
          totalBytes: contextResult.totalBytes,
          estimatedTokens: contextResult.estimatedTokens,
          extensionBreakdown: contextResult.extensionBreakdown.map((e) => ({
            extension: e.extension,
            fileCount: e.fileCount,
            estimatedTokens: e.estimatedTokens,
          })),
          largestFiles: contextResult.largestFiles.map((f) => ({
            path: f.path,
            estimatedTokens: f.estimatedTokens,
          })),
          fitEstimates: contextResult.fitEstimates.map((f) => ({
            windowLabel: f.windowLabel,
            fits: f.fits,
            utilization: f.utilization,
            headroom: f.headroom,
          })),
        },
        assets: assets.map((a) => ({
          path: a.path,
          type: a.type,
          confidence: a.confidence,
          reason: a.reason,
        })),
        models: models.map((m) => ({
          id: m.id,
          provider: m.provider,
          name: m.name,
          contextWindow: m.contextWindow,
          inputPricePer1M: m.inputPricePer1M,
          outputPricePer1M: m.outputPricePer1M,
        })),
        doctor: doctor.map((d) => ({
          name: d.name,
          status: d.status,
          message: d.message,
        })),
        workflow,
      };

      const html = generateDashboard(dashboardData);

      // Create HTTP server
      const server = createServer((_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Frame-Options': 'DENY',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'",
        });
        res.end(html);
      });

      server.listen(port, '127.0.0.1', () => {
        const url = `http://localhost:${port}`;
        console.log(
          `  ${chalk.green('Ready')}  Dashboard running at ${chalk.cyan(url)}\n`,
        );
        console.log(chalk.dim('  Press Ctrl+C to stop.\n'));

        if (options.open) {
          openBrowser(url);
        }
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(
            `Error: port ${port} is already in use. Try --port <other-port>.`,
          );
        } else {
          console.error(`Error starting server: ${err.message}`);
        }
        process.exitCode = 1;
      });
    });
}
