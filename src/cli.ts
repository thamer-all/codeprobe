#!/usr/bin/env node
/**
 * codeprobe — DevTools for AI Coding
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
import { registerHistoryCommand } from './commands/history.js';
import { registerAutotestCommand } from './commands/autotest.js';
import { registerRecommendCommand } from './commands/recommend.js';
import { registerAbCommand } from './commands/ab.js';
import { registerScoreCommand } from './commands/score.js';
import { registerFlakyCommand } from './commands/flaky.js';
import { registerScanCommand } from './commands/scan.js';
import { registerCheckCommand } from './commands/check.js';
import { registerSummaryCommand } from './commands/summary.js';
import { registerExportCommand } from './commands/export.js';
import { registerServeCommand } from './commands/serve.js';
import { handleError } from './utils/errors.js';

const program = new Command();

program
  .name('codeprobe')
  .version('0.1.0')
  .description('DevTools for AI Coding — context engineering toolkit for Claude, Cursor, Copilot, and more')
  .addHelpText('after', `
Examples:
  $ codeprobe                          Dashboard (default)
  $ codeprobe scan                     Full project analysis
  $ codeprobe test                     Run prompt tests
  $ codeprobe context .                Analyze token usage
  $ codeprobe cost .                   Estimate API costs
  $ codeprobe generate-rules           Generate AI tool configs

Quick start:
  $ codeprobe init && codeprobe scan
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
registerHistoryCommand(program);
registerAutotestCommand(program);
registerRecommendCommand(program);
registerAbCommand(program);
registerScoreCommand(program);
registerFlakyCommand(program);
registerScanCommand(program);
registerCheckCommand(program);
registerSummaryCommand(program);
registerExportCommand(program);
registerServeCommand(program);

// Smart default: if no command given, run dashboard on current directory
if (process.argv.length === 2) {
  process.argv.push('dashboard', '.');
}

program.parseAsync(process.argv).catch(handleError);
