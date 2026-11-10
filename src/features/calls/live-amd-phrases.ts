// Classifica o texto parcial de uma ligação a partir de frases de operadora
// em português. Não lê áudio, não chama fornecedor e não grava no CRM.
// A decisão de silêncio (ninguém atendeu) só entra depois de 15 segundos sem fala
// na janela dos últimos 15 segundos.

export const LIVE_AMD_LISTEN_MS = 15_000;

export type LiveAmdLabel = 'human' | 'no_answer' | 'voicemail' | 'number_not_exist';

export interface LiveAmdDecision {
  label: LiveAmdLabel | 'unknown';
  phrase: string | null;
  confidence: number;
}

export interface LiveAmdInput {
  transcript: string;
  /** Tempo sem fala dentro da janela dos últimos 15 segundos. Sem esse dado, silêncio não vira no_answer. */
  elapsedMs?: number;
}

interface PhraseRule {
  label: Exclude<LiveAmdLabel, 'human' | 'no_answer'>;
  phrase: string;
}

/** Frases de operadora, já sem acento. A mais longa que couber no texto ganha. */
const CARRIER_PHRASES: readonly PhraseRule[] = [
  { label: 'number_not_exist', phrase: 'o numero chamado nao existe' },
  { label: 'number_not_exist', phrase: 'o numero discado nao existe' },
  { label: 'number_not_exist', phrase: 'numero chamado nao existe' },
  { label: 'number_not_exist', phrase: 'este numero nao existe' },
  { label: 'number_not_exist', phrase: 'esse numero nao existe' },
  { label: 'number_not_exist', phrase: 'numero inexistente' },
  { label: 'number_not_exist', phrase: 'telefone inexistente' },
  { label: 'number_not_exist', phrase: 'nao foi possivel completar' },
  { label: 'number_not_exist', phrase: 'fora de area' },
  { label: 'voicemail', phrase: 'sua chamada esta sendo encaminhada para a caixa de mensagens' },
  { label: 'voicemail', phrase: 'sua chamada esta sendo encaminhada para a caixa postal' },
  { label: 'voicemail', phrase: 'encaminhada para a caixa de mensagens' },
  { label: 'voicemail', phrase: 'encaminhada para a caixa postal' },
  { label: 'voicemail', phrase: 'grave a sua mensagem' },
  { label: 'voicemail', phrase: 'grave sua mensagem' },
  { label: 'voicemail', phrase: 'deixe a sua mensagem' },
  { label: 'voicemail', phrase: 'deixe sua mensagem' },
  { label: 'voicemail', phrase: 'deixe seu recado' },
  { label: 'voicemail', phrase: 'caixa de mensagens' },
  { label: 'voicemail', phrase: 'caixa postal' },
  { label: 'voicemail', phrase: 'secretaria eletronica' },
  { label: 'voicemail', phrase: 'apos o sinal' },
  { label: 'voicemail', phrase: 'apos o tom' },
];

const GREETINGS = ['quem fala', 'pois nao', 'alo', 'ola', 'oi', 'pronto', 'diga', 'fala'] as const;

const UNKNOWN: LiveAmdDecision = { label: 'unknown', phrase: null, confidence: 0 };

function stripAccents(text: string): string {
  return text
    .replace(/[áàâã]/g, 'a')
    .replace(/[éê]/g, 'e')
    .replace(/[íî]/g, 'i')
    .replace(/[óôõ]/g, 'o')
    .replace(/[úû]/g, 'u')
    .replace(/ç/g, 'c');
}

export function normalizeLiveAmdText(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function matchCarrier(text: string): PhraseRule | null {
  let best: PhraseRule | null = null;
  for (const rule of CARRIER_PHRASES) {
    if (!hasPhrase(text, rule.phrase)) continue;
    if (!best || rule.phrase.length > best.phrase.length) best = rule;
  }
  return best;
}

function soundsLikePerson(text: string): boolean {
  if (GREETINGS.some((greeting) => hasPhrase(text, greeting))) return true;
  const words = text.split(' ').filter((word) => word.length > 0);
  return words.length >= 4;
}

export function classifyLiveAmd(input: LiveAmdInput): LiveAmdDecision {
  const text = normalizeLiveAmdText(input.transcript);
  const carrier = text ? matchCarrier(text) : null;
  if (carrier) {
    return { label: carrier.label, phrase: carrier.phrase, confidence: 0.92 };
  }
  if (text && soundsLikePerson(text)) {
    return { label: 'human', phrase: null, confidence: 0.6 };
  }
  const elapsed = input.elapsedMs ?? 0;
  if (!text && elapsed >= LIVE_AMD_LISTEN_MS) {
    return { label: 'no_answer', phrase: null, confidence: 0.7 };
  }
  return UNKNOWN;
}
