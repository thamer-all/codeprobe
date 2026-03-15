/**
 * Universal model registry for claude-test.
 *
 * Contains pricing, context-window, and capability metadata for AI models
 * across all major providers. Used by the benchmark runner for cost estimation
 * and by the CLI for model discovery.
 */

export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  contextWindow: number;
  maxOutput: number;
  inputPricePer1M: number;   // USD per million tokens
  outputPricePer1M: number;  // USD per million tokens
}

/** Internal model registry keyed by model id. */
const MODEL_REGISTRY: Map<string, ModelInfo> = new Map();

function register(model: ModelInfo): void {
  MODEL_REGISTRY.set(model.id, model);
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------
register({ id: 'claude-opus-4-6', provider: 'anthropic', name: 'Claude Opus 4.6', contextWindow: 200000, maxOutput: 16384, inputPricePer1M: 15, outputPricePer1M: 75 });
register({ id: 'claude-sonnet-4-6', provider: 'anthropic', name: 'Claude Sonnet 4.6', contextWindow: 200000, maxOutput: 16384, inputPricePer1M: 3, outputPricePer1M: 15 });
register({ id: 'claude-haiku-4-5', provider: 'anthropic', name: 'Claude Haiku 4.5', contextWindow: 200000, maxOutput: 8192, inputPricePer1M: 0.80, outputPricePer1M: 4 });

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------
register({ id: 'gpt-4.1', provider: 'openai', name: 'GPT-4.1', contextWindow: 1047576, maxOutput: 32768, inputPricePer1M: 2, outputPricePer1M: 8 });
register({ id: 'gpt-4.1-mini', provider: 'openai', name: 'GPT-4.1 Mini', contextWindow: 1047576, maxOutput: 32768, inputPricePer1M: 0.40, outputPricePer1M: 1.60 });
register({ id: 'gpt-4.1-nano', provider: 'openai', name: 'GPT-4.1 Nano', contextWindow: 1047576, maxOutput: 32768, inputPricePer1M: 0.10, outputPricePer1M: 0.40 });
register({ id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', contextWindow: 128000, maxOutput: 16384, inputPricePer1M: 2.50, outputPricePer1M: 10 });
register({ id: 'o3', provider: 'openai', name: 'o3', contextWindow: 200000, maxOutput: 100000, inputPricePer1M: 2, outputPricePer1M: 8 });
register({ id: 'o4-mini', provider: 'openai', name: 'o4-mini', contextWindow: 200000, maxOutput: 100000, inputPricePer1M: 1.10, outputPricePer1M: 4.40 });

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------
register({ id: 'gemini-2.5-pro', provider: 'google', name: 'Gemini 2.5 Pro', contextWindow: 1048576, maxOutput: 65536, inputPricePer1M: 1.25, outputPricePer1M: 10 });
register({ id: 'gemini-2.5-flash', provider: 'google', name: 'Gemini 2.5 Flash', contextWindow: 1048576, maxOutput: 65536, inputPricePer1M: 0.15, outputPricePer1M: 0.60 });

// ---------------------------------------------------------------------------
// DeepSeek
// ---------------------------------------------------------------------------
register({ id: 'deepseek-v3', provider: 'deepseek', name: 'DeepSeek V3', contextWindow: 131072, maxOutput: 8192, inputPricePer1M: 0.27, outputPricePer1M: 1.10 });
register({ id: 'deepseek-r1', provider: 'deepseek', name: 'DeepSeek R1', contextWindow: 131072, maxOutput: 8192, inputPricePer1M: 0.55, outputPricePer1M: 2.19 });

// ---------------------------------------------------------------------------
// Qwen (Alibaba)
// ---------------------------------------------------------------------------
register({ id: 'qwen-3-235b', provider: 'qwen', name: 'Qwen 3 235B', contextWindow: 131072, maxOutput: 8192, inputPricePer1M: 0.80, outputPricePer1M: 2.40 });
register({ id: 'qwen-3-32b', provider: 'qwen', name: 'Qwen 3 32B', contextWindow: 131072, maxOutput: 8192, inputPricePer1M: 0.20, outputPricePer1M: 0.60 });

// ---------------------------------------------------------------------------
// Meta (via API providers)
// ---------------------------------------------------------------------------
register({ id: 'llama-4-maverick', provider: 'meta', name: 'Llama 4 Maverick', contextWindow: 1048576, maxOutput: 16384, inputPricePer1M: 0.20, outputPricePer1M: 0.60 });
register({ id: 'llama-4-scout', provider: 'meta', name: 'Llama 4 Scout', contextWindow: 524288, maxOutput: 16384, inputPricePer1M: 0.10, outputPricePer1M: 0.30 });

// ---------------------------------------------------------------------------
// Mistral
// ---------------------------------------------------------------------------
register({ id: 'codestral-25.01', provider: 'mistral', name: 'Codestral', contextWindow: 256000, maxOutput: 8192, inputPricePer1M: 0.30, outputPricePer1M: 0.90 });
register({ id: 'mistral-large', provider: 'mistral', name: 'Mistral Large', contextWindow: 131072, maxOutput: 8192, inputPricePer1M: 2, outputPricePer1M: 6 });

// ---------------------------------------------------------------------------
// Local (Ollama / vLLM — free)
// ---------------------------------------------------------------------------
register({ id: 'local', provider: 'local', name: 'Local Model', contextWindow: 131072, maxOutput: 8192, inputPricePer1M: 0, outputPricePer1M: 0 });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Look up a model by its id. Returns undefined if not found. */
export function getModel(id: string): ModelInfo | undefined {
  return MODEL_REGISTRY.get(id);
}

/** Return every registered model. */
export function getAllModels(): ModelInfo[] {
  return Array.from(MODEL_REGISTRY.values());
}

/** Return all models belonging to a specific provider. */
export function getModelsByProvider(provider: string): ModelInfo[] {
  return getAllModels().filter((m) => m.provider === provider);
}

/** Return the distinct list of provider names, sorted alphabetically. */
export function getProviders(): string[] {
  const providers = new Set(getAllModels().map((m) => m.provider));
  return Array.from(providers).sort();
}

/**
 * Get the context window size for a model.
 * Returns 200 000 as a safe default when the model id is not found.
 */
export function getContextWindow(modelId: string): number {
  const model = MODEL_REGISTRY.get(modelId);
  return model ? model.contextWindow : 200_000;
}

/**
 * Estimate the dollar cost for a given number of input and output tokens.
 * Returns 0 when the model is not in the registry.
 */
export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const model = MODEL_REGISTRY.get(modelId);
  if (!model) return 0;
  const inputCost = (inputTokens / 1_000_000) * model.inputPricePer1M;
  const outputCost = (outputTokens / 1_000_000) * model.outputPricePer1M;
  return inputCost + outputCost;
}
