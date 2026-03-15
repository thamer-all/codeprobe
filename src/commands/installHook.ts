/**
 * `claude-test install-hook` — Install a Claude Code hook into .claude/settings.json.
 *
 * Merges a hook entry (e.g. PreCommit) into the project's Claude settings
 * without overwriting existing entries.
 */

import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileExists, readTextFile } from '../utils/fs.js';

interface HookEntry {
  command: string;
  description: string;
}

interface ClaudeSettings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

export function registerInstallHookCommand(program: Command): void {
  program
    .command('install-hook')
    .description('Install a Claude Code hook into .claude/settings.json')
    .option('--event <event>', 'Hook event name', 'PreCommit')
    .option('--command <cmd>', 'Command to run', 'claude-test test --json')
    .option('--dry-run', 'Show what would be written without modifying files')
    .action(async (options: {
      event: string;
      command: string;
      dryRun?: boolean;
    }) => {
      const chalk = (await import('chalk')).default;

      const projectRoot = process.cwd();
      const claudeDir = join(projectRoot, '.claude');
      const settingsPath = join(claudeDir, 'settings.json');

      // Read existing settings or start fresh
      let settings: ClaudeSettings = {};
      if (await fileExists(settingsPath)) {
        const content = await readTextFile(settingsPath);
        if (content) {
          try {
            settings = JSON.parse(content) as ClaudeSettings;
          } catch {
            console.error(chalk.red('Error: .claude/settings.json contains invalid JSON.'));
            process.exitCode = 1;
            return;
          }
        }
      }

      // Ensure hooks object exists
      if (!settings.hooks) {
        settings.hooks = {};
      }

      // Ensure event array exists
      const eventName = options.event;
      if (!settings.hooks[eventName]) {
        settings.hooks[eventName] = [];
      }

      const newEntry: HookEntry = {
        command: options.command,
        description: 'Run prompt regression tests',
      };

      // Check for duplicate — same command already registered
      const existing = settings.hooks[eventName];
      const alreadyExists = existing.some((e) => e.command === newEntry.command);

      if (alreadyExists) {
        console.log(chalk.yellow(
          `\nHook already exists: ${eventName} -> "${newEntry.command}"\n` +
          'No changes made.\n',
        ));
        return;
      }

      // Append to the array (merge, not overwrite)
      existing.push(newEntry);

      const resultJson = JSON.stringify(settings, null, 2);

      if (options.dryRun) {
        console.log(chalk.dim('\n[dry-run] Would write to .claude/settings.json:\n'));
        console.log(resultJson);
        console.log('');
        return;
      }

      // Create .claude/ directory if needed
      await mkdir(claudeDir, { recursive: true });

      // Write settings
      await writeFile(settingsPath, resultJson + '\n', 'utf-8');

      console.log(chalk.green('\nHook installed successfully!\n'));
      console.log(`  Event:   ${chalk.bold(eventName)}`);
      console.log(`  Command: ${chalk.bold(newEntry.command)}`);
      console.log(`  File:    ${chalk.dim('.claude/settings.json')}`);
      console.log('');
    });
}
