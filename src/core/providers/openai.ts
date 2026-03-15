/**
 * OpenAI-compatible provider — works with OpenAI, DeepSeek, Qwen,
 * Mistral, and any OpenAI-compatible API endpoint.
 *
 * Uses fetch() directly (built into Node 18+) so no SDK dependency is needed.
 */

import type { ProviderClient, ProviderRequest, ProviderResponse } from './base.js';

function sanitizeError(text: string): string {
  return text
    .replace(/(?:key|token|bearer|authorization|api[_-]?key|secret|password|x-api-key)[=:\s]*["']?[a-zA-Z0-9_\-\.]{10,}["']?/gi, '[REDACTED]')
    .replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED]')
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]{10,}/gi, 'Bearer [REDACTED]');
}

export interface OpenAIProviderOptions {
  baseURL?: string;
  apiKeyEnv?: string;
}

export class OpenAIProvider implements ProviderClient {
  private baseURL: string;
  private apiKeyEnv: string;

  constructor(options?: OpenAIProviderOptions) {
    this.baseURL = options?.baseURL ?? 'https://api.openai.com/v1';
    this.apiKeyEnv = options?.apiKeyEnv ?? 'OPENAI_API_KEY';
  }

  async isAvailable(): Promise<boolean> {
    return !!process.env[this.apiKeyEnv];
  }

  async call(request: ProviderRequest): Promise<ProviderResponse> {
    const apiKey = process.env[this.apiKeyEnv];
    if (!apiKey) {
      throw new Error(`${this.apiKeyEnv} is required`);
    }

    const body = {
      model: request.model,
      messages: [
        ...(request.system ? [{ role: 'system' as const, content: request.system }] : []),
        ...request.messages,
      ],
      max_tokens: request.maxTokens ?? 1024,
    };

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = sanitizeError(await response.text());
      throw new Error(`API error (${response.status}): ${errorText.slice(0, 500)}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const choices = data.choices as Array<{ message: { content: string } }>;
    const usage = data.usage as { prompt_tokens: number; completion_tokens: number } | undefined;

    return {
      content: choices[0]?.message?.content ?? '',
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      model: request.model,
      stopReason: 'stop',
    };
  }
}
