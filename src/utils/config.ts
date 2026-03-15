/**
 * Configuration loader for codeprobe.
 * Looks for .codeprobe.json or .codeprobe.yaml in the project root.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { CodeprobeConfig } from '../types/config.js';
import { fileExists } from './fs.js';

const ConfigSchema = z.object({
  defaultModel: z.string().optional(),
  defaultContextTarget: z.enum(['200k', '1m']).optional(),
  ignorePaths: z.array(z.string()).optional(),
  caching: z.boolean().optional(),
  watchDefaults: z.object({
    debounceMs: z.number().optional(),
    clearScreen: z.boolean().optional(),
  }).optional(),
  contextBudgets: z.object({
    systemPrompt: z.number().optional(),
    coreFiles: z.number().optional(),
    docs: z.number().optional(),
    toolMeta: z.number().optional(),
  }).optional(),
  benchmarkDefaults: z.object({
    models: z.array(z.string()).optional(),
    runs: z.number().optional(),
    warmup: z.boolean().optional(),
  }).optional(),
}).passthrough();

const CONFIG_FILE_NAMES = [
  '.codeprobe.json',
  '.codeprobe.yaml',
  '.codeprobe.yml',
  'codeprobe.config.json',
  'codeprobe.config.yaml',
  // Backward compat: also check legacy config file names
  '.claude-test.json',
  '.claude-test.yaml',
  '.claude-test.yml',
  'claude-test.config.json',
  'claude-test.config.yaml',
];

/**
 * Load configuration from the project root.
 * Returns a default config if no config file is found.
 */
export async function loadConfig(rootPath: string): Promise<CodeprobeConfig> {
  for (const name of CONFIG_FILE_NAMES) {
    const configPath = join(rootPath, name);
    if (await fileExists(configPath)) {
      try {
        const content = await readFile(configPath, 'utf-8');
        const raw = name.endsWith('.json')
          ? JSON.parse(content) as unknown
          : yaml.load(content) as unknown;
        return ConfigSchema.parse(raw) as CodeprobeConfig;
      } catch {
        // Fall through to default
      }
    }
  }

  return getDefaultConfig();
}

/**
 * Return the default configuration.
 */
export function getDefaultConfig(): CodeprobeConfig {
  return {
    defaultModel: 'claude-sonnet-4-20250514',
    defaultContextTarget: '200k',
    ignorePaths: [],
    caching: true,
    contextBudgets: {
      systemPrompt: 0.1,
      coreFiles: 0.5,
      docs: 0.2,
      toolMeta: 0.1,
    },
  };
}
