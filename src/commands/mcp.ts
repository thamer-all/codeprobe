/**
 * `claude-test mcp [path]` — Detect MCP (Model Context Protocol) configs.
 */

import { Command } from 'commander';
import { resolvePath } from '../utils/paths.js';
import { walkDirectory, getRelativePath, readTextFile } from '../utils/fs.js';
import { setLogLevel } from '../utils/logger.js';
import type { MCPAsset } from '../types/agent.js';

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.cache', '.turbo',
]);

/** Patterns for detecting MCP-related files. */
const MCP_PATTERNS: Array<{
  namePattern: RegExp;
  type: MCPAsset['type'];
  description: string;
}> = [
  {
    namePattern: /^\.?mcp\.json$/i,
    type: 'mcp-config',
    description: 'MCP configuration file',
  },
  {
    namePattern: /^\.?mcp\.(ya?ml)$/i,
    type: 'mcp-config',
    description: 'MCP configuration file',
  },
  {
    namePattern: /^\.?mcp-server/i,
    type: 'mcp-server',
    description: 'MCP server implementation',
  },
  {
    namePattern: /mcp[-_]?config\.(json|ya?ml)$/i,
    type: 'mcp-config',
    description: 'MCP configuration file',
  },
  {
    namePattern: /claude_desktop_config\.json$/i,
    type: 'mcp-config',
    description: 'Claude Desktop MCP configuration',
  },
  {
    namePattern: /\.claude\.json$/i,
    type: 'mcp-related',
    description: 'Claude configuration (may contain MCP)',
  },
];

/**
 * Scan for MCP configurations and servers.
 */
async function mcpScanner(rootPath: string): Promise<MCPAsset[]> {
  const entries = await walkDirectory(rootPath, { ignoreDirs: DEFAULT_IGNORE_DIRS });
  const assets: MCPAsset[] = [];

  for (const entry of entries) {
    const relPath = getRelativePath(rootPath, entry.path);
    const fileName = entry.path.split('/').pop() ?? '';

    for (const pattern of MCP_PATTERNS) {
      if (pattern.namePattern.test(fileName)) {
        const asset: MCPAsset = {
          path: relPath,
          type: pattern.type,
          description: pattern.description,
        };

        // Try to extract server name and transport from JSON configs
        if (entry.isFile && entry.size < 100_000 && fileName.endsWith('.json')) {
          const content = await readTextFile(entry.path);
          if (content) {
            try {
              const parsed = JSON.parse(content) as Record<string, unknown>;
              if (parsed['mcpServers'] && typeof parsed['mcpServers'] === 'object') {
                const servers = parsed['mcpServers'] as Record<string, unknown>;
                const names = Object.keys(servers);
                if (names.length > 0) {
                  asset.serverName = names.join(', ');
                }
              }
              if (typeof parsed['transport'] === 'string') {
                asset.transport = parsed['transport'];
              }
            } catch {
              // Invalid JSON — skip extraction
            }
          }
        }

        assets.push(asset);
        break;
      }
    }

    // Also check if any TS/JS files export MCP-related content
    if (entry.isFile && /\.(ts|js|mjs)$/.test(entry.extension) && entry.size < 100_000) {
      const content = await readTextFile(entry.path);
      if (content && /McpServer|@modelcontextprotocol|mcp\.createServer/i.test(content)) {
        assets.push({
          path: relPath,
          type: 'mcp-server',
          description: 'File containing MCP server code',
        });
      }
    }
  }

  return assets;
}

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp [path]')
    .description('Detect MCP (Model Context Protocol) configurations and servers')
    .option('--json', 'Output findings as JSON')
    .action(async (
      pathArg: string | undefined,
      options: { json?: boolean },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? '.');

      const assets = await mcpScanner(targetPath);

      if (options.json) {
        console.log(JSON.stringify(assets, null, 2));
        return;
      }

      if (assets.length === 0) {
        console.log(chalk.dim('\nNo MCP configurations or servers found.\n'));
        return;
      }

      console.log(chalk.bold(`\nMCP Assets (${assets.length} found)`));
      console.log('');

      // Group by type
      const typeLabels: Record<MCPAsset['type'], string> = {
        'mcp-config': 'Configurations',
        'mcp-server': 'Servers',
        'mcp-related': 'Related Files',
      };

      const grouped = new Map<MCPAsset['type'], MCPAsset[]>();
      for (const asset of assets) {
        const list = grouped.get(asset.type) ?? [];
        list.push(asset);
        grouped.set(asset.type, list);
      }

      for (const [type, items] of grouped) {
        console.log(chalk.bold(`  ${typeLabels[type]}`));
        for (const item of items) {
          let line = `    ${item.path}`;
          if (item.serverName) {
            line += chalk.cyan(`  servers: ${item.serverName}`);
          }
          if (item.transport) {
            line += chalk.dim(`  transport: ${item.transport}`);
          }
          line += chalk.dim(`  ${item.description}`);
          console.log(line);
        }
        console.log('');
      }
    });
}
