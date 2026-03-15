/**
 * `claude-test doctor` — Run environment diagnostics to check that
 * all dependencies and configurations are in place.
 */

import { Command } from 'commander';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setLogLevel } from '../utils/logger.js';
import type { DiagnosticCheck } from '../types/diagnostics.js';

const execFileAsync = promisify(execFile);

/**
 * Run a single diagnostic check.
 */
async function checkNodeVersion(): Promise<DiagnosticCheck> {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0]!, 10);

  if (major >= 18) {
    return { name: 'Node.js version', status: 'pass', message: `${version} (>= 18 required)` };
  }
  return { name: 'Node.js version', status: 'fail', message: `${version} (>= 18 required)` };
}

async function checkNpmInstalled(): Promise<DiagnosticCheck> {
  try {
    const { stdout } = await execFileAsync('npm', ['--version']);
    return { name: 'npm', status: 'pass', message: `v${stdout.trim()}` };
  } catch {
    return { name: 'npm', status: 'fail', message: 'npm not found' };
  }
}

async function checkGitInstalled(): Promise<DiagnosticCheck> {
  try {
    const { stdout } = await execFileAsync('git', ['--version']);
    return { name: 'git', status: 'pass', message: stdout.trim() };
  } catch {
    return { name: 'git', status: 'warn', message: 'git not found (optional)' };
  }
}

async function checkPackageJson(): Promise<DiagnosticCheck> {
  const pkgPath = join(process.cwd(), 'package.json');
  try {
    await access(pkgPath);
    const content = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content) as Record<string, unknown>;
    return {
      name: 'package.json',
      status: 'pass',
      message: `Found (${pkg['name'] ?? 'unnamed'})`,
    };
  } catch {
    return { name: 'package.json', status: 'warn', message: 'Not found in current directory' };
  }
}

async function checkClaudeTestConfig(): Promise<DiagnosticCheck> {
  const configNames = [
    'claude-test.config.yaml',
    'claude-test.config.yml',
    'claude-test.config.json',
    '.claude-test.yaml',
    '.claude-test.json',
  ];

  for (const name of configNames) {
    try {
      await access(join(process.cwd(), name));
      return { name: 'claude-test config', status: 'pass', message: `Found: ${name}` };
    } catch {
      // Try next
    }
  }

  return {
    name: 'claude-test config',
    status: 'warn',
    message: 'No config file found. Run `claude-test init` to create one.',
  };
}

async function checkPromptsDir(): Promise<DiagnosticCheck> {
  const promptsDir = join(process.cwd(), 'prompts');
  try {
    await access(promptsDir);
    return { name: 'prompts/ directory', status: 'pass', message: 'Found' };
  } catch {
    return {
      name: 'prompts/ directory',
      status: 'warn',
      message: 'Not found. Run `claude-test init` to create starter files.',
    };
  }
}

async function checkClaudeMd(): Promise<DiagnosticCheck> {
  const claudeMdPath = join(process.cwd(), 'CLAUDE.md');
  try {
    await access(claudeMdPath);
    const content = await readFile(claudeMdPath, 'utf-8');
    const lineCount = content.split('\n').length;
    return {
      name: 'CLAUDE.md',
      status: 'pass',
      message: `Found (${lineCount} lines)`,
    };
  } catch {
    return {
      name: 'CLAUDE.md',
      status: 'warn',
      message: 'Not found. Consider creating a CLAUDE.md for context engineering.',
    };
  }
}

async function checkTiktoken(): Promise<DiagnosticCheck> {
  try {
    await import('tiktoken');
    return { name: 'tiktoken', status: 'pass', message: 'Available for accurate token counting' };
  } catch {
    return {
      name: 'tiktoken',
      status: 'warn',
      message: 'Not available. Falling back to character-based estimation.',
      details: 'Install tiktoken for accurate token counting: npm install tiktoken',
    };
  }
}

async function checkDiskSpace(): Promise<DiagnosticCheck> {
  try {
    const cacheDir = join(process.env['HOME'] ?? '/tmp', '.claude-test', 'cache');
    try {
      await access(cacheDir);
      return { name: 'Cache directory', status: 'pass', message: cacheDir };
    } catch {
      return { name: 'Cache directory', status: 'pass', message: `Will be created at: ${cacheDir}` };
    }
  } catch {
    return { name: 'Cache directory', status: 'warn', message: 'Could not determine cache location' };
  }
}

/**
 * Run all diagnostic checks.
 */
async function doctorRunner(): Promise<DiagnosticCheck[]> {
  const checks = await Promise.all([
    checkNodeVersion(),
    checkNpmInstalled(),
    checkGitInstalled(),
    checkPackageJson(),
    checkClaudeTestConfig(),
    checkPromptsDir(),
    checkClaudeMd(),
    checkTiktoken(),
    checkDiskSpace(),
  ]);

  return checks;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Environment diagnostics — check dependencies, configuration, and setup')
    .option('--json', 'Output diagnostics as JSON')
    .action(async (options: { json?: boolean }) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;

      const checks = await doctorRunner();

      if (options.json) {
        console.log(JSON.stringify(checks, null, 2));
        return;
      }

      console.log(chalk.bold('\nEnvironment Diagnostics'));
      console.log('');

      const statusIcon = (s: DiagnosticCheck['status']): string => {
        switch (s) {
          case 'pass': return chalk.green('PASS');
          case 'warn': return chalk.yellow('WARN');
          case 'fail': return chalk.red('FAIL');
        }
      };

      for (const check of checks) {
        console.log(`  ${statusIcon(check.status)}  ${check.name}: ${check.message}`);
        if (check.details) {
          console.log(chalk.dim(`         ${check.details}`));
        }
      }

      console.log('');

      const passCount = checks.filter((c) => c.status === 'pass').length;
      const warnCount = checks.filter((c) => c.status === 'warn').length;
      const failCount = checks.filter((c) => c.status === 'fail').length;

      console.log(
        chalk.bold('Summary: ') +
        chalk.green(`${passCount} passed`) + ', ' +
        (warnCount > 0 ? chalk.yellow(`${warnCount} warnings`) : `${warnCount} warnings`) + ', ' +
        (failCount > 0 ? chalk.red(`${failCount} failed`) : `${failCount} failed`),
      );
      console.log('');

      if (failCount > 0) {
        process.exitCode = 1;
      }
    });
}
