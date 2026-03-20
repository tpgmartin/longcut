import { createGeminiAdapter } from './gemini-adapter';
import { createGrokAdapter } from './grok-adapter';
import { createOpenAICompatibleAdapter } from './openai-compatible-adapter';
import type { ProviderAdapter, ProviderGenerateParams, ProviderGenerateResult } from './types';

/**
 * Provider registry with support for:
 *
 * 1. Generic OpenAI-compatible provider (default) — works with any service
 *    that exposes /chat/completions: OpenAI, Groq, Together, Mistral,
 *    Ollama, vLLM, DeepSeek, Fireworks, etc.
 *    Env: AI_API_KEY, AI_API_BASE_URL, AI_MODEL
 *
 * 2. Legacy provider-specific adapters (Gemini, Grok) — kept for backward
 *    compatibility. Activated when their specific env vars are set.
 *    Env: GEMINI_API_KEY or XAI_API_KEY
 */

type ProviderKey = 'openai-compatible' | 'grok' | 'gemini';

type ProviderFactory = () => ProviderAdapter;

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function createGenericAdapter(): ProviderAdapter {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'AI_API_KEY is required. Set this environment variable to your LLM provider API key.'
    );
  }

  return createOpenAICompatibleAdapter({
    apiKey,
    baseUrl: (process.env.AI_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
    defaultModel: process.env.AI_MODEL ?? DEFAULT_MODEL,
    providerName: process.env.AI_PROVIDER_NAME ?? 'openai-compatible',
  });
}

const providerFactories: Record<ProviderKey, ProviderFactory> = {
  'openai-compatible': createGenericAdapter,
  grok: createGrokAdapter,
  gemini: createGeminiAdapter,
};

const providerEnvGuards: Record<ProviderKey, () => string | undefined> = {
  'openai-compatible': () => process.env.AI_API_KEY,
  grok: () => process.env.XAI_API_KEY,
  gemini: () => process.env.GEMINI_API_KEY,
};

const providerCache: Partial<Record<ProviderKey, ProviderAdapter>> = {};

function resolveProviderKey(preferred?: string): ProviderKey {
  const envPreference =
    preferred ??
    process.env.AI_PROVIDER ??
    process.env.NEXT_PUBLIC_AI_PROVIDER;

  if (envPreference && envPreference in providerFactories) {
    return envPreference as ProviderKey;
  }

  // Auto-detect: generic first, then legacy providers
  if (providerEnvGuards['openai-compatible']()) {
    return 'openai-compatible';
  }
  if (providerEnvGuards.grok()) {
    return 'grok';
  }
  if (providerEnvGuards.gemini()) {
    return 'gemini';
  }

  return 'openai-compatible';
}

export function getProviderKey(preferred?: string): ProviderKey {
  return resolveProviderKey(preferred);
}

function ensureProvider(key: ProviderKey): ProviderAdapter {
  if (providerCache[key]) {
    return providerCache[key]!;
  }

  const guard = providerEnvGuards[key];
  if (!guard()) {
    throw new Error(
      `AI provider "${key}" is not configured. Please supply the required environment variables.`
    );
  }

  const factory = providerFactories[key];
  const adapter = factory();
  providerCache[key] = adapter;
  return adapter;
}

export function availableProviders(): ProviderKey[] {
  return (Object.keys(providerFactories) as ProviderKey[]).filter((key) => {
    try {
      return !!providerEnvGuards[key]();
    } catch {
      return false;
    }
  });
}

export function getProvider(key?: string): ProviderAdapter {
  const resolvedKey = resolveProviderKey(key);
  console.log(`[AI Provider] Using provider: ${resolvedKey}`);
  return ensureProvider(resolvedKey);
}

function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes('service unavailable') ||
    lowerMessage.includes('503') ||
    lowerMessage.includes('502') ||
    lowerMessage.includes('504') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('overload')
  );
}

function getFallbackProvider(currentKey: ProviderKey): ProviderKey | null {
  const available = availableProviders();
  const fallback = available.find((key) => key !== currentKey);
  return fallback ?? null;
}

export async function generateStructuredContent(
  params: ProviderGenerateParams & { provider?: string }
): Promise<ProviderGenerateResult> {
  const { provider, ...rest } = params;
  const primaryKey = resolveProviderKey(provider);
  const primaryAdapter = getProvider(provider);

  try {
    return await primaryAdapter.generate(rest);
  } catch (error) {
    // If the error is retryable and we have a fallback provider, try it
    if (isRetryableError(error)) {
      const fallbackKey = getFallbackProvider(primaryKey);
      if (fallbackKey) {
        console.warn(
          `[AI Provider] ${primaryKey} failed with retryable error, trying fallback: ${fallbackKey}`
        );
        try {
          const fallbackAdapter = ensureProvider(fallbackKey);
          console.log(`[AI Provider] Using fallback provider: ${fallbackKey}`);
          return await fallbackAdapter.generate(rest);
        } catch (fallbackError) {
          console.error(`[AI Provider] Fallback provider ${fallbackKey} also failed:`, fallbackError);
          throw error;
        }
      }
    }
    throw error;
  }
}
