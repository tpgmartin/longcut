type ClientProviderKey = 'openai-compatible' | 'grok' | 'gemini';

function resolveClientProviderKey(): ClientProviderKey {
  const rawProvider = process.env.NEXT_PUBLIC_AI_PROVIDER;
  const normalized =
    typeof rawProvider === 'string' ? rawProvider.trim().toLowerCase() : undefined;

  if (normalized === 'gemini') return 'gemini';
  if (normalized === 'grok') return 'grok';
  if (normalized === 'openai-compatible') return 'openai-compatible';

  return 'openai-compatible';
}

export function getClientProviderKey(): ClientProviderKey {
  return resolveClientProviderKey();
}

/**
 * Returns true when the active provider only supports smart mode
 * (i.e. does not support fast/chunked analysis).
 * Currently only Grok has this limitation.
 */
export function isGrokProviderOnClient(): boolean {
  return resolveClientProviderKey() === 'grok';
}
