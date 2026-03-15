/**
 * Google Gemini provider — uses the REST API directly via fetch().
 * No SDK dependency required.
 */

import type { ProviderClient, ProviderRequest, ProviderResponse } from './base.js';

function sanitizeError(text: string): string {
  return text
    .replace(/(?:key|token|bearer|authorization|api[_-]?key|secret|password|x-goog-api-key)[=:\s]*["']?[a-zA-Z0-9_\-\.]{10,}["']?/gi, '[REDACTED]')
    .replace(/AIza[a-zA-Z0-9_\-]{30,}/g, '[REDACTED]')
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]{10,}/gi, 'Bearer [REDACTED]');
}

export class GoogleProvider implements ProviderClient {
  async isAvailable(): Promise<boolean> {
    return !!process.env.GOOGLE_API_KEY;
  }

  async call(request: ProviderRequest): Promise<ProviderResponse> {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY is required');
    }

    const contents = request.messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: { maxOutputTokens: request.maxTokens ?? 1024 },
    };

    if (request.system) {
      body.systemInstruction = { parts: [{ text: request.system }] };
    }

    // Validate model name to prevent URL injection
    if (!/^[a-zA-Z0-9_\-.:]+$/.test(request.model)) {
      throw new Error(`Invalid model name: ${request.model}`);
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = sanitizeError(await response.text());
      throw new Error(`Gemini API error (${response.status}): ${errorText.slice(0, 500)}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const candidates = data.candidates as Array<{ content: { parts: Array<{ text: string }> } }>;
    const usageMetadata = data.usageMetadata as {
      promptTokenCount: number;
      candidatesTokenCount: number;
    } | undefined;

    return {
      content: candidates?.[0]?.content?.parts?.[0]?.text ?? '',
      inputTokens: usageMetadata?.promptTokenCount ?? 0,
      outputTokens: usageMetadata?.candidatesTokenCount ?? 0,
      model: request.model,
      stopReason: 'stop',
    };
  }
}
