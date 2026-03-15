/**
 * Anthropic API client — thin wrapper for live execution mode.
 *
 * Uses dynamic import so anthropic SDK is optional.
 * Install with: npm install @anthropic-ai/sdk
 */

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicRequest {
  model: string;
  system?: string;
  messages: AnthropicMessage[];
  maxTokens?: number;
}

export interface AnthropicResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  stopReason: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clientInstance: any = null;

export async function isAnthropicAvailable(): Promise<boolean> {
  try {
    const SDK_MODULE = '@anthropic-ai/sdk';
    await import(SDK_MODULE);
    return !!process.env.ANTHROPIC_API_KEY;
  } catch {
    return false;
  }
}

export async function callAnthropic(request: AnthropicRequest): Promise<AnthropicResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required for live mode');
  }

  try {
    // Dynamic import — only loaded when live mode is used.
    // Use a string variable to prevent TypeScript from attempting
    // static module resolution on an optional dependency.
    const SDK_MODULE = '@anthropic-ai/sdk';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(SDK_MODULE);
    const Anthropic = mod.default ?? mod.Anthropic ?? mod;

    if (!clientInstance) {
      clientInstance = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }

    const response = await clientInstance.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? 1024,
      system: request.system,
      messages: request.messages,
    });

    // Extract text content from response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contentBlocks = response.content as Array<{ type: string; text?: string }>;
    const text = contentBlocks
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { type: string; text?: string }) => block.text ?? '')
      .join('');

    return {
      content: text,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      model: request.model,
      stopReason: response.stop_reason ?? 'unknown',
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes('Cannot find package')) {
      throw new Error(
        'Live mode requires the Anthropic SDK. Install it with: npm install @anthropic-ai/sdk',
      );
    }
    throw err;
  }
}
