#!/usr/bin/env node
/**
 * claude-test — DevTools for AI Coding
 * Context engineering toolkit for Claude, Cursor, Copilot, and more.
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
import { registerWorkflowCommand } from './commands/workflow.js';
import { registerModelsCommand } from './commands/models.js';
import { registerUiCommand } from './commands/ui.js';
import { registerDashboardCommand } from './commands/dashboard.js';
import { registerCostCommand } from './commands/cost.js';
import { registerGenerateRulesCommand } from './commands/generateRules.js';
import { registerRegressionCommand } from './commands/regression.js';
import { handleError } from './utils/errors.js';

const program = new Command();

program
  .name('claude-test')
  .version('0.1.0')
  .description('DevTools for AI Coding — context engineering toolkit for Claude, Cursor, Copilot, and more')
  .addHelpText('after', `
Examples:
  $ claude-test init                    Create starter project
  $ claude-test test                    Run all prompt tests
  $ claude-test context .               Analyze repo context usage
  $ claude-test pack . --target 200k    Build context pack plan
  $ claude-test simulate . --model gpt-4o   Simulate against model context window
  $ claude-test workflow run ci         Run a named workflow
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
registerWorkflowCommand(program);
registerModelsCommand(program);
registerUiCommand(program);
registerDashboardCommand(program);
registerCostCommand(program);
registerGenerateRulesCommand(program);
registerRegressionCommand(program);

program.parseAsync(process.argv).catch(handleError);
