// Classifica o texto parcial de uma ligação a partir de frases de operadora
// em português. Não lê áudio, não chama fornecedor e não grava no CRM.
// A decisão de silêncio (ninguém atendeu) só entra depois de 15 segundos sem fala
// e sem energia de áudio na janela dos últimos 15 segundos.

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
  /**
   * Houve áudio com energia na janela, mas o texto veio vazio.
   * Isso fica inconclusivo: não vira não atendido.
   */
  hadEnergy?: boolean;
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
  { label: 'number_not_exist', phrase: 'o numero informado nao existe' },
  { label: 'number_not_exist', phrase: 'numero inexistente' },
  { label: 'number_not_exist', phrase: 'telefone inexistente' },
  { label: 'number_not_exist', phrase: 'nao foi possivel completar' },
  { label: 'number_not_exist', phrase: 'nao foi possivel completar a sua chamada' },
  { label: 'voicemail', phrase: 'vamos entregar o seu recado assim que o celular estiver disponivel' },
  { label: 'voicemail', phrase: 'entregar o seu recado assim que o celular estiver disponivel' },
  { label: 'voicemail', phrase: 'assim que o celular estiver disponivel' },
  { label: 'voicemail', phrase: 'quando o celular estiver disponivel' },
  { label: 'voicemail', phrase: 'o celular estiver disponivel' },
  { label: 'voicemail', phrase: 'celular estiver disponivel' },
  { label: 'voicemail', phrase: 'sua chamada esta sendo encaminhada para a caixa de mensagens' },
  { label: 'voicemail', phrase: 'sua chamada esta sendo encaminhada para a caixa postal' },
  { label: 'voicemail', phrase: 'sua ligacao esta sendo encaminhada para a caixa postal' },
  { label: 'voicemail', phrase: 'sua chamada foi encaminhada para a caixa postal' },
  { label: 'voicemail', phrase: 'encaminhada para a caixa de mensagens' },
  { label: 'voicemail', phrase: 'encaminhada para a caixa postal' },
  { label: 'voicemail', phrase: 'a pessoa que voce esta tentando ligar nao pode atender' },
  { label: 'voicemail', phrase: 'a pessoa chamada nao pode atender' },
  { label: 'voicemail', phrase: 'o assinante nao pode atender' },
  { label: 'voicemail', phrase: 'no momento nao pode atender' },
  { label: 'voicemail', phrase: 'nao pode atender' },
  { label: 'voicemail', phrase: 'grave a sua mensagem apos o sinal' },
  { label: 'voicemail', phrase: 'grave sua mensagem apos o sinal' },
  { label: 'voicemail', phrase: 'grave a sua mensagem apos o bipe' },
  { label: 'voicemail', phrase: 'grave sua mensagem apos o bipe' },
  { label: 'voicemail', phrase: 'grave a sua mensagem' },
  { label: 'voicemail', phrase: 'grave sua mensagem' },
  { label: 'voicemail', phrase: 'grave o seu recado' },
  { label: 'voicemail', phrase: 'deixe a sua mensagem apos o sinal' },
  { label: 'voicemail', phrase: 'deixe sua mensagem apos o sinal' },
  { label: 'voicemail', phrase: 'deixe a sua mensagem' },
  { label: 'voicemail', phrase: 'deixe sua mensagem' },
  { label: 'voicemail', phrase: 'deixe o seu recado' },
  { label: 'voicemail', phrase: 'deixe seu recado' },
  { label: 'voicemail', phrase: 'deixe um recado' },
  { label: 'voicemail', phrase: 'por favor deixe seu recado' },
  { label: 'voicemail', phrase: 'entregar o seu recado' },
  { label: 'voicemail', phrase: 'entregar seu recado' },
  { label: 'voicemail', phrase: 'caixa de mensagens' },
  { label: 'voicemail', phrase: 'caixa postal' },
  { label: 'voicemail', phrase: 'correio de voz' },
  { label: 'voicemail', phrase: 'secretaria eletronica' },
  { label: 'voicemail', phrase: 'apos o sinal sonoro' },
  { label: 'voicemail', phrase: 'apos o sinal' },
  { label: 'voicemail', phrase: 'apos o tom' },
  { label: 'voicemail', phrase: 'apos o bipe' },
  { label: 'voicemail', phrase: 'o celular esta desligado ou fora da area' },
  { label: 'voicemail', phrase: 'o telefone chamado esta desligado' },
  { label: 'voicemail', phrase: 'desligado ou fora da area' },
  { label: 'voicemail', phrase: 'esta fora da area de cobertura' },
  { label: 'voicemail', phrase: 'fora da area de cobertura' },
  { label: 'number_not_exist', phrase: 'fora de area' },
];

/**
 * Fragmentos para transcrição cortada. Todos os pedaços precisam aparecer.
 * "recado" + "disponivel" pega a frase da operadora mesmo sem a sentença inteira.
 */
const CARRIER_FRAGMENTS: readonly { label: PhraseRule['label']; parts: readonly string[]; phrase: string }[] = [
  { label: 'voicemail', parts: ['recado', 'disponivel'], phrase: 'recado disponivel' },
  { label: 'voicemail', parts: ['entregar', 'recado'], phrase: 'entregar recado' },
  { label: 'voicemail', parts: ['celular', 'disponivel'], phrase: 'celular disponivel' },
  { label: 'voicemail', parts: ['grave', 'mensagem'], phrase: 'grave mensagem' },
  { label: 'voicemail', parts: ['deixe', 'recado'], phrase: 'deixe recado' },
  { label: 'voicemail', parts: ['apos', 'sinal'], phrase: 'apos o sinal' },
  { label: 'voicemail', parts: ['caixa', 'postal'], phrase: 'caixa postal' },
  { label: 'voicemail', parts: ['caixa', 'mensagens'], phrase: 'caixa de mensagens' },
  { label: 'voicemail', parts: ['nao', 'pode', 'atender'], phrase: 'nao pode atender' },
  { label: 'voicemail', parts: ['desligado', 'fora', 'area'], phrase: 'desligado ou fora da area' },
  { label: 'voicemail', parts: ['fora', 'area', 'cobertura'], phrase: 'fora da area de cobertura' },
  { label: 'number_not_exist', parts: ['numero', 'nao', 'existe'], phrase: 'numero nao existe' },
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
  return stripAccents(text.toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

/** Palavra inteira, ou um corte da transcrição que ainda começa com o radical. */
function hasToken(text: string, token: string): boolean {
  if (hasPhrase(text, token)) return true;
  if (token.length < 6) return false;
  const stem = token.slice(0, Math.min(6, token.length - 1));
  return text.split(' ').some((word) => word.startsWith(stem) && word.length + 2 >= token.length);
}

function matchCarrier(text: string): { label: PhraseRule['label']; phrase: string; confidence: number } | null {
  let best: PhraseRule | null = null;
  for (const rule of CARRIER_PHRASES) {
    if (!hasPhrase(text, rule.phrase)) continue;
    if (!best || rule.phrase.length > best.phrase.length) best = rule;
  }
  if (best) return { label: best.label, phrase: best.phrase, confidence: 0.92 };

  let fragment: (typeof CARRIER_FRAGMENTS)[number] | null = null;
  for (const rule of CARRIER_FRAGMENTS) {
    if (!rule.parts.every((part) => hasToken(text, part))) continue;
    const size = rule.parts.join(' ').length;
    const current = fragment ? fragment.parts.join(' ').length : 0;
    if (!fragment || size > current) fragment = rule;
  }
  if (fragment) return { label: fragment.label, phrase: fragment.phrase, confidence: 0.84 };
  return null;
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
    return { label: carrier.label, phrase: carrier.phrase, confidence: carrier.confidence };
  }
  if (text && soundsLikePerson(text)) {
    return { label: 'human', phrase: null, confidence: 0.6 };
  }
  const elapsed = input.elapsedMs ?? 0;
  if (!text && elapsed >= LIVE_AMD_LISTEN_MS && !input.hadEnergy) {
    return { label: 'no_answer', phrase: null, confidence: 0.7 };
  }
  return UNKNOWN;
}
