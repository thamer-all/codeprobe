/**
 * `codeprobe serve` — Start as an MCP (Model Context Protocol) server.
 *
 * Exposes codeprobe analysis tools to AI assistants (Claude, Cursor, etc.)
 * via the MCP stdio transport using raw JSON-RPC 2.0 over stdin/stdout.
 *
 * No external MCP SDK dependency required.
 */

import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { analyzeContext } from '../core/contextAnalyzer.js';
import { scanForClaudeAssets } from '../core/agentTracer.js';
import { estimateTokens } from '../tokenizers/claudeTokenizer.js';
import { lintDirectory } from '../core/promptLinter.js';
import { scanSecurity } from '../core/securityScanner.js';
import { getAllModels, estimateCost } from '../core/modelRegistry.js';

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

// ---------------------------------------------------------------------------
// MCP tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'analyze_context',
    description:
      'Analyze repository context — token counts, file breakdown, context window fit estimates',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path to analyze (default: current directory)',
        },
      },
    },
  },
  {
    name: 'scan_assets',
    description:
      'Scan for AI coding tool configurations — Claude, Cursor, Windsurf, Copilot, Aider, etc.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan',
        },
      },
    },
  },
  {
    name: 'estimate_tokens',
    description: 'Estimate token count for a text string',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description: 'Text to count tokens for',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'lint_prompts',
    description: 'Lint prompt spec files for quality issues',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path to lint',
        },
      },
    },
  },
  {
    name: 'security_scan',
    description:
      'Scan prompt files for injection vulnerabilities and leaked secrets',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan',
        },
      },
    },
  },
  {
    name: 'list_models',
    description:
      'List all supported AI models with context windows and pricing',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'estimate_cost',
    description:
      'Estimate the cost of sending a repository as context to a model',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path to analyze',
        },
        model: {
          type: 'string',
          description: 'Model ID (e.g., claude-sonnet-4-6)',
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  // ---- MCP lifecycle: initialize ----
  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'codeprobe', version: '0.1.0' },
      },
    };
  }

  // ---- MCP lifecycle: notifications/initialized ----
  if (req.method === 'notifications/initialized') {
    return { jsonrpc: '2.0', id: req.id, result: {} };
  }

  // ---- tools/list ----
  if (req.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: { tools: TOOLS },
    };
  }

  // ---- tools/call ----
  if (req.method === 'tools/call') {
    const params = req.params as {
      name: string;
      arguments?: Record<string, unknown>;
    };
    const toolName = params.name;
    const args = params.arguments ?? {};
    const path = (args.path as string) ?? process.cwd();

    try {
      let result: unknown;

      switch (toolName) {
        case 'analyze_context': {
          const analysis = await analyzeContext(path);
          result = {
            totalFiles: analysis.totalFiles,
            estimatedTokens: analysis.estimatedTokens,
            totalBytes: analysis.totalBytes,
            extensionBreakdown: analysis.extensionBreakdown.slice(0, 10),
            fitEstimates: analysis.fitEstimates,
            largestFiles: analysis.largestFiles.slice(0, 10),
          };
          break;
        }
        case 'scan_assets': {
          const assets = await scanForClaudeAssets(path);
          result = assets;
          break;
        }
        case 'estimate_tokens': {
          const text = args.text as string;
          result = { tokens: estimateTokens(text), characters: text.length };
          break;
        }
        case 'lint_prompts': {
          const warnings = await lintDirectory(path);
          result = warnings;
          break;
        }
        case 'security_scan': {
          const findings = await scanSecurity(path);
          result = findings;
          break;
        }
        case 'list_models': {
          result = getAllModels();
          break;
        }
        case 'estimate_cost': {
          const analysis = await analyzeContext(path);
          const model = (args.model as string) ?? 'claude-sonnet-4-6';
          const inputCost = estimateCost(model, analysis.estimatedTokens, 0);
          const outputCost = estimateCost(model, 0, 1000);
          result = {
            model,
            tokens: analysis.estimatedTokens,
            inputCost,
            outputCost1k: outputCost,
          };
          break;
        }
        default:
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: -32601,
              message: `Unknown tool: ${toolName}`,
            },
          };
      }

      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [
            { type: 'text', text: JSON.stringify(result, null, 2) },
          ],
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: -32000,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  // ---- Unknown method ----
  return {
    jsonrpc: '2.0',
    id: req.id,
    error: { code: -32601, message: `Unknown method: ${req.method}` },
  };
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description(
      'Start as MCP server — expose codeprobe tools to AI assistants',
    )
    .option('--stdio', 'Use stdio transport (default)', true)
    .action(async () => {
      // Read JSON-RPC messages from stdin, one per line, write responses to stdout
      const rl = createInterface({ input: process.stdin });

      rl.on('line', async (line: string) => {
        try {
          const request: JsonRpcRequest = JSON.parse(line) as JsonRpcRequest;
          const response = await handleRequest(request);
          process.stdout.write(JSON.stringify(response) + '\n');
        } catch {
          // Ignore malformed input lines
        }
      });
    });
}
