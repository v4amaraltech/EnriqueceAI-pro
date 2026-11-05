// Cliente OpenRouter compartilhado pela transcrição (Whisper), análise BANT e
// classificação do resultado da ligação (mesma OPENROUTER_API_KEY — provedor único).

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const WHISPER_MODEL = 'openai/whisper-1';
export const ANALYSIS_MODEL = 'openai/gpt-4.1';

export function getOpenRouterApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY não configurada');
  }
  return apiKey;
}

export function openRouterHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    // Identifica a aplicação no painel do OpenRouter.
    'X-Title': 'EnriqueceAI',
  };
  if (process.env.NEXT_PUBLIC_APP_URL) headers['HTTP-Referer'] = process.env.NEXT_PUBLIC_APP_URL;
  return headers;
}
