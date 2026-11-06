// Classifica o resultado de uma ligação ATENDIDA do Power Dialer a partir da
// transcrição (nov/2026). Saída validada por Zod; qualquer resposta fora do
// formato vira erro (quem chama grava `ai_outcome.status = 'failed'` + Revisar).
import { z } from 'zod';

import { brtDateKey, isBrBusinessDay } from '@/lib/utils/br-holidays';
import { addDaysIso, parseBrtDateTime } from '@/lib/utils/brt-date';

import { AI_OUTCOME_REVIEW_CONFIDENCE, aiDispositionValues, type AiDisposition } from '../ai-outcome';
import { ANALYSIS_MODEL, OPENROUTER_BASE_URL, getOpenRouterApiKey, openRouterHeaders } from './openrouter-client';

/** Transcrição maior que isso é cortada (custo; uma ligação de ~20 min cabe). */
const MAX_TRANSCRIPTION_CHARS = 16_000;
const MAX_SUMMARY_LINES = 3;
const MAX_SUMMARY_CHARS = 500;

const classifierResponseSchema = z.object({
  disposition: z.enum(aiDispositionValues),
  confidence: z.coerce.number().min(0).max(1),
  summary: z.string().trim().min(1),
  callback_at: z.string().trim().nullish(),
});

export interface CallOutcomeInput {
  transcription: string;
  durationSeconds: number;
  /** Instante da ligação (para a IA resolver "amanhã às 15h"). */
  calledAt: Date;
}

export interface CallOutcomeClassification {
  disposition: AiDisposition;
  confidence: number;
  summary: string;
  /** ISO UTC. Só em `callback_requested`: data pedida ou próximo dia útil 9h BRT. */
  callback_at: string | null;
  /** O lead pediu um horário que a IA entendeu (false = usamos o padrão). */
  callback_time_from_lead: boolean;
  needs_review: boolean;
  model: string;
}

const WEEKDAYS_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** "2026-11-05 (quinta-feira) 14:32" em BRT. */
export function formatBrtForPrompt(date: Date): string {
  const brt = new Date(date.getTime() - 3 * 3600 * 1000);
  const iso = brt.toISOString();
  return `${iso.slice(0, 10)} (${WEEKDAYS_PT[brt.getUTCDay()]}) ${iso.slice(11, 16)}`;
}

/** Próximo dia útil (seg–sex, sem feriado nacional) depois de `from`, às 9h BRT. */
export function nextBusinessDay9hBrt(from: Date): Date {
  let key = addDaysIso(brtDateKey(from), 1);
  while (!isBrBusinessDay(key)) key = addDaysIso(key, 1);
  return new Date(`${key}T12:00:00.000Z`); // 9h BRT = 12h UTC
}

export function buildCallOutcomePrompt(input: CallOutcomeInput): string {
  const transcription = input.transcription.slice(0, MAX_TRANSCRIPTION_CHARS);
  return `Você analisa ligações de prospecção B2B feitas por um SDR brasileiro (pré-vendas). A ligação foi ATENDIDA e gravada. Leia a transcrição e classifique o resultado.

Data/hora da ligação (horário de Brasília): ${formatBrtForPrompt(input.calledAt)}
Duração: ${input.durationSeconds} segundos

Categorias (campo "disposition"):
- "relevant_conversation": conversa de verdade com o decisor ou alguém relevante, com avanço (interesse, qualificação, reunião, envio de material combinado).
- "answered_no_progress": uma pessoa atendeu mas não houve avanço (sem interesse, número errado, recusa, pessoa errada sem encaminhamento, desligou).
- "callback_requested": a pessoa pediu para ligar em outro momento (ex.: "me liga amanhã às 15h", "estou em reunião, liga mais tarde", "fala com ele segunda").
- "voicemail": caixa postal, secretária eletrônica, mensagem gravada da operadora ("o número chamado não existe", "está fora da área", "deixe seu recado"), URA/menu automático sem humano.
- "technical_failure": áudio vazio, mudo, cortado ou incompreensível; ninguém consegue conversar.

Regras:
- Na dúvida entre categorias, escolha a mais provável e baixe "confidence".
- "confidence" de 0 a 1 (1 = certeza absoluta).
- "summary": resumo em português do Brasil, no máximo 3 linhas curtas, no tom de anotação de SDR (quem atendeu, o que foi dito, próximo passo). Não invente nada que não esteja na transcrição.
- "callback_at": SÓ em "callback_requested". Se a pessoa disse quando ligar, devolva no formato "YYYY-MM-DDTHH:mm" no horário de Brasília, calculado a partir da data/hora da ligação acima ("amanhã às 15h" → dia seguinte 15:00; "mais tarde" sem hora → null; "semana que vem" sem dia → null). Sem data/hora clara → null.

Responda APENAS com um JSON neste formato:
{"disposition": "...", "confidence": 0.0, "summary": "...", "callback_at": null}

Transcrição:
"""
${transcription}
"""`;
}

/** Corta o resumo em até 3 linhas / 500 caracteres. */
function clampSummary(summary: string): string {
  const lines = summary
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_SUMMARY_LINES);
  const joined = lines.join('\n');
  return joined.length > MAX_SUMMARY_CHARS ? `${joined.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…` : joined;
}

/**
 * Transforma o texto devolvido pelo modelo no resultado final. Puro (testável).
 * Lança erro se o texto não tiver um JSON válido no formato esperado.
 */
export function parseCallOutcomeResponse(text: string, now: Date, model = ANALYSIS_MODEL): CallOutcomeClassification {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last <= first) {
    throw new Error(`classifier_no_json: ${text.slice(0, 200)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(first, last + 1));
  } catch {
    throw new Error(`classifier_invalid_json: ${text.slice(0, 200)}`);
  }

  const parsed = classifierResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`classifier_invalid_shape: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`);
  }

  const { disposition, confidence, summary } = parsed.data;

  let callbackAt: string | null = null;
  let fromLead = false;
  if (disposition === 'callback_requested') {
    const requested = parsed.data.callback_at ? parseBrtDateTime(parsed.data.callback_at) : null;
    // Horário pedido no passado (IA errou o dia) → cai no padrão.
    if (requested && requested.getTime() > now.getTime()) {
      callbackAt = requested.toISOString();
      fromLead = true;
    } else {
      callbackAt = nextBusinessDay9hBrt(now).toISOString();
    }
  }

  return {
    disposition,
    confidence,
    summary: clampSummary(summary),
    callback_at: callbackAt,
    callback_time_from_lead: fromLead,
    needs_review: confidence < AI_OUTCOME_REVIEW_CONFIDENCE,
    model,
  };
}

/** Chama o modelo e devolve a classificação. Lança erro em falha de rede/IA/formato. */
export async function classifyCallOutcome(
  input: CallOutcomeInput,
  now: Date = new Date(),
): Promise<CallOutcomeClassification> {
  const apiKey = getOpenRouterApiKey();

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: openRouterHeaders(apiKey),
    body: JSON.stringify({
      model: ANALYSIS_MODEL,
      max_tokens: 600,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: buildCallOutcomePrompt(input) }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => 'no body');
    throw new Error(`classifier_api_error: ${response.status} — ${errBody.slice(0, 200)}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return parseCallOutcomeResponse(data.choices?.[0]?.message?.content ?? '', now);
}
