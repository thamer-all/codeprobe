#!/usr/bin/env node
/**
 * claude-test — DevTools for Claude
 * Context engineering toolkit for Claude Code.
 */

import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerTestCommand } from './commands/test.js';
import { registerDiffCommand } from './commands/diff.js';
import { registerContextCommand } from './commands/context.js';
import { registerSimulateCommand } from './commands/simulate.js';
import { registerPackCommand } from './commands/pack.js';
import { registerBenchmarkCommand } from './commands/benchmark.js';
import { registerAgentsCommand } from './commands/agents.js';
import { registerHooksCommand } from './commands/hooks.js';
import { registerMcpCommand } from './commands/mcp.js';
import { registerLintCommand } from './commands/lint.js';
import { registerImproveCommand } from './commands/improve.js';
import { registerMapCommand } from './commands/map.js';
import { registerHeatmapCommand } from './commands/heatmap.js';
import { registerExplainCommand } from './commands/explain.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerSecurityCommand } from './commands/security.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerReplCommand } from './commands/repl.js';
import { registerGenerateClaudeMdCommand } from './commands/generateClaudeMd.js';
import { registerInstallHookCommand } from './commands/installHook.js';
import { handleError } from './utils/errors.js';

const program = new Command();

program
  .name('claude-test')
  .version('0.1.0')
  .description('DevTools for Claude — context engineering toolkit for Claude Code')
  .addHelpText('after', `
Examples:
  $ claude-test init                    Create starter project
  $ claude-test test                    Run all prompt tests
  $ claude-test context .               Analyze repo context usage
  $ claude-test pack . --target 200k    Build context pack plan
  $ claude-test doctor                  Check environment setup
`);

registerInitCommand(program);
registerTestCommand(program);
registerDiffCommand(program);
registerContextCommand(program);
registerSimulateCommand(program);
registerPackCommand(program);
registerBenchmarkCommand(program);
registerAgentsCommand(program);
registerHooksCommand(program);
registerMcpCommand(program);
registerLintCommand(program);
registerImproveCommand(program);
registerMapCommand(program);
registerHeatmapCommand(program);
registerExplainCommand(program);
registerValidateCommand(program);
registerSecurityCommand(program);
registerDoctorCommand(program);
registerReplCommand(program);
registerGenerateClaudeMdCommand(program);
registerInstallHookCommand(program);

program.parseAsync(process.argv).catch(handleError);
