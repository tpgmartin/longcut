import { z } from 'zod';
import type { ProviderAdapter, ProviderGenerateParams, ProviderGenerateResult } from './types';

/**
 * Generic OpenAI-compatible adapter.
 *
 * Works with any provider that exposes the `/chat/completions` endpoint:
 * OpenAI, Anthropic (via proxy), Groq, Together, Mistral, Ollama, vLLM,
 * xAI (Grok), DeepSeek, Fireworks, and many more.
 *
 * Configuration via environment variables:
 *   AI_API_KEY       – Bearer token for the provider
 *   AI_API_BASE_URL  – Base URL (e.g. https://api.openai.com/v1)
 *   AI_MODEL         – Default model name
 */

const PROVIDER_NAME = 'openai-compatible';

// JSON Schema properties that some providers don't support in structured output
const UNSUPPORTED_SCHEMA_PROPS = [
  'minLength', 'maxLength',
  'minItems', 'maxItems',
  'minContains', 'maxContains',
  '$schema',
];

function sanitizeSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;

  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchema);
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_SCHEMA_PROPS.includes(key)) continue;
    result[key] = sanitizeSchema(value);
  }
  return result;
}

function ensureSchemaName(name?: string) {
  if (name && name.trim().length > 0) return name.trim();
  return 'ResponseSchema';
}

function buildAbortController(timeoutMs?: number) {
  if (!timeoutMs || timeoutMs <= 0 || typeof AbortController === 'undefined') {
    return { controller: undefined, clear: () => undefined };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, clear: () => clearTimeout(timer) };
}

function extractTextFromChoice(choice: any): string {
  if (!choice) return '';

  const message = choice.message ?? choice.delta ?? {};
  const { content } = message;

  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part) continue;
      if (typeof part === 'string') return part;
      if (typeof part.text === 'string') return part.text;
      if (typeof part.output_text === 'string') return part.output_text;
      if (typeof part.data === 'string') return part.data;
    }
  }

  if (typeof message.text === 'string') return message.text;
  return '';
}

function normalizeUsage(raw: any, latencyMs: number | undefined) {
  if (!raw) return latencyMs ? { latencyMs } : undefined;

  const promptTokens =
    raw.prompt_tokens ?? raw.promptTokens ?? raw.input_tokens ?? raw.inputTokens;
  const completionTokens =
    raw.completion_tokens ?? raw.completionTokens ?? raw.output_tokens ?? raw.outputTokens;
  const totalTokens =
    raw.total_tokens ?? raw.totalTokens ??
    (typeof promptTokens === 'number' && typeof completionTokens === 'number'
      ? promptTokens + completionTokens
      : undefined);

  return { promptTokens, completionTokens, totalTokens, latencyMs };
}

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  providerName?: string;
}

function buildPayload(params: ProviderGenerateParams, defaultModel: string) {
  const payload: Record<string, any> = {
    model: params.model ?? defaultModel,
    messages: [{ role: 'user', content: params.prompt }],
  };

  if (typeof params.temperature === 'number') payload.temperature = params.temperature;
  if (typeof params.topP === 'number') payload.top_p = params.topP;
  if (typeof params.maxOutputTokens === 'number') payload.max_output_tokens = params.maxOutputTokens;

  if (params.zodSchema) {
    try {
      const jsonSchema = z.toJSONSchema(params.zodSchema);
      const sanitized = sanitizeSchema(jsonSchema);
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: ensureSchemaName(params.schemaName),
          schema: sanitized,
        },
      };
    } catch (error) {
      console.error('[OpenAI-compatible] Failed to convert Zod schema', error);
      throw new Error(
        error instanceof Error
          ? `Failed to convert schema: ${error.message}`
          : 'Failed to convert schema'
      );
    }
  }

  return payload;
}

export function createOpenAICompatibleAdapter(config: OpenAICompatibleConfig): ProviderAdapter {
  const { apiKey, baseUrl, defaultModel, providerName } = config;
  const name = providerName || PROVIDER_NAME;

  return {
    name,
    defaultModel,
    async generate(params: ProviderGenerateParams): Promise<ProviderGenerateResult> {
      const { controller, clear } = buildAbortController(params.timeoutMs);
      const requestStartedAt = Date.now();

      try {
        const payload = buildPayload(params, defaultModel);
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller?.signal,
        });

        const responseText = await response.text();
        let parsed: any;

        try {
          parsed = responseText ? JSON.parse(responseText) : undefined;
        } catch {
          console.error(`[${name}] Failed to parse JSON response`);
          throw new Error(`${name} API returned a non-JSON response.`);
        }

        if (!response.ok) {
          const message =
            parsed?.error?.message || parsed?.message || response.statusText || 'Unknown error';
          const code = parsed?.error?.code || parsed?.code;
          throw new Error(`${name} API error${code ? ` (${code})` : ''}: ${message}`);
        }

        const latencyMs = Date.now() - requestStartedAt;
        const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : undefined;
        const content = extractTextFromChoice(choice);

        if (!content) {
          throw new Error(`${name} API returned an empty response.`);
        }

        return {
          content,
          rawResponse: parsed,
          provider: name,
          model: parsed?.model ?? payload.model,
          usage: normalizeUsage(parsed?.usage, latencyMs),
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new Error(`${name} request timed out.`);
        }
        throw error;
      } finally {
        clear();
      }
    },
  };
}
