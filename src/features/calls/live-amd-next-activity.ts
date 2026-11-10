import { OPENROUTER_BASE_URL, openRouterHeaders } from '@/features/calls/services/openrouter-client';

import type { NextActivitySuggestion } from '@/features/integrations/webphone/live-amd-session';

export const LIVE_AMD_ACTIVITY_MODEL = 'openai/gpt-5-nano';

export interface NextActivityResult {
  suggestion: NextActivitySuggestion;
  reason: string;
  confidence: number;
}

const SUGGESTIONS = new Set<NextActivitySuggestion>(['schedule_meeting', 'schedule_callback', 'not_connected']);

/**
 * Lê a transcrição acumulada e devolve só uma sugestão. Não cria atividade
 * nem agenda. Sem OPENROUTER_API_KEY, devolve null e a ligação segue normal.
 * Modelo: gpt-5-nano via OpenRouter (US$ 0,05 / US$ 0,40 por 1M de tokens
 * na tabela de 10/11/2026). Se o modelo falhar, devolve null.
 * Fonte: https://openrouter.ai/openai/gpt-5-nano
 */
export async function suggestNextActivity(
  input: { transcript: string; prediction: string },
  fetchImpl: typeof fetch = fetch,
): Promise<NextActivityResult | null> {
  if (!input.transcript.trim()) {
    if (input.prediction === 'human') return null;
    return { suggestion: 'not_connected', reason: 'Sem fala do outro lado na ligação.', confidence: 0.7 };
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetchImpl(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify({
        model: LIVE_AMD_ACTIVITY_MODEL,
        temperature: 0,
        max_tokens: 120,
        messages: [
          {
            role: 'system',
            content:
              'Você sugere a próxima atividade de um lead depois de uma ligação de prospecção em português do Brasil. Responda só JSON com suggestion, reason e confidence. suggestion é schedule_meeting (a pessoa combinou ou aceitou uma reunião), schedule_callback (pediu para retornar, estava ocupada, ou vale tentar de novo) ou not_connected (caixa postal, não atendeu, número inexistente, ou não houve conversa). reason é uma frase curta. confidence vai de 0 a 1. Não invente horário nem compromisso que não esteja no texto.',
          },
          {
            role: 'user',
            content: `Classe ouvida: ${input.prediction}\nTranscrição:\n${input.transcript.slice(0, 8000)}`,
          },
        ],
      }),
    });
    if (!response.ok) {
      console.error('[webphone-live-amd] sugestão recusada:', response.status);
      return null;
    }
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return parseNextActivity(payload.choices?.[0]?.message?.content ?? '');
  } catch (err) {
    console.error('[webphone-live-amd] falha na sugestão:', err);
    return null;
  }
}

export function parseNextActivity(raw: string): NextActivityResult | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const json = JSON.parse(raw.slice(start, end + 1)) as { suggestion?: unknown; reason?: unknown; confidence?: unknown };
    if (typeof json.suggestion !== 'string' || !SUGGESTIONS.has(json.suggestion as NextActivitySuggestion)) return null;
    const confidence = typeof json.confidence === 'number' ? Math.max(0, Math.min(1, json.confidence)) : 0.5;
    const reason = typeof json.reason === 'string' ? json.reason.trim().slice(0, 240) : '';
    return { suggestion: json.suggestion as NextActivitySuggestion, reason, confidence };
  } catch {
    return null;
  }
}
