/**
 * `claude-test models` — List all available models from the registry.
 *
 * Displays a formatted table of model ID, provider, name, context window,
 * and pricing. Supports filtering by provider and JSON output.
 */

import { Command } from 'commander';
import { getAllModels, getModelsByProvider, getProviders } from '../core/modelRegistry.js';
import type { ModelInfo } from '../core/modelRegistry.js';

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toString();
}

function formatPrice(price: number): string {
  if (price === 0) return 'free';
  if (price < 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(2)}`;
}

function printTable(models: ModelInfo[]): void {
  // Column headers
  const headers = ['ID', 'Provider', 'Name', 'Context', 'Input $/1M', 'Output $/1M'];

  // Build rows
  const rows = models.map((m) => [
    m.id,
    m.provider,
    m.name,
    formatNumber(m.contextWindow),
    formatPrice(m.inputPricePer1M),
    formatPrice(m.outputPricePer1M),
  ]);

  // Calculate column widths
  const colWidths = headers.map((h, i) => {
    const dataMax = rows.reduce((max, row) => Math.max(max, row[i]!.length), 0);
    return Math.max(h.length, dataMax);
  });

  // Format a row
  const formatRow = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(colWidths[i]!)).join('  ');

  // Print
  console.log('');
  console.log(formatRow(headers));
  console.log(colWidths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log(formatRow(row));
  }
  console.log('');
  console.log(`${models.length} models from ${new Set(models.map((m) => m.provider)).size} providers`);
}

export function registerModelsCommand(program: Command): void {
  program
    .command('models')
    .description('List all available models with pricing and capabilities')
    .option('--provider <provider>', 'Filter by provider (e.g. openai, anthropic, google)')
    .option('--json', 'Output as JSON')
    .action(async (options: { provider?: string; json?: boolean }) => {
      let models: ModelInfo[];

      if (options.provider) {
        models = getModelsByProvider(options.provider);
        if (models.length === 0) {
          const providers = getProviders();
          if (options.json) {
            console.log(JSON.stringify({ models: [], error: `No models found for provider "${options.provider}"`, providers }, null, 2));
          } else {
            const chalk = (await import('chalk')).default;
            console.log(chalk.yellow(`\nNo models found for provider "${options.provider}".`));
            console.log(chalk.dim(`Available providers: ${providers.join(', ')}`));
          }
          return;
        }
      } else {
        models = getAllModels();
      }

      if (options.json) {
        console.log(JSON.stringify({ models }, null, 2));
        return;
      }

      const chalk = (await import('chalk')).default;
      const label = options.provider
        ? `Models for provider: ${chalk.bold(options.provider)}`
        : 'All available models';
      console.log(chalk.bold(`\n${label}`));
      printTable(models);
    });
}
