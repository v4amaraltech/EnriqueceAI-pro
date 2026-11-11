import { JEV_LOW_CONFIDENCE, JEV_MODEL, JEV_URL, JEV_USD_PER_INPUT_MTOK } from './constants';
import type { Utterance } from './assemblyai.client';

export const OUTCOME_OPTIONS = {
  meeting_booked: 'O cliente aceitou ou marcou reunião/demonstração com data ou horário combinado.',
  callback: 'O cliente pediu para ligar de novo mais tarde ou em outra data.',
  not_connected: 'Caixa postal, secretária eletrônica, ligação sem conversa real com o decisor.',
  not_interested: 'O cliente recusou claramente e não quer continuar.',
  interested_no_next_step: 'Há interesse, mas nada foi combinado como próximo passo.',
  other: 'Nenhuma das anteriores.',
} as const;

export const INTEREST_LEVELS = ['none', 'low', 'medium', 'high'] as const;

export const OBJECTION_OPTIONS = {
  price: 'Objeção de preço ou orçamento.',
  timing: 'Não é o momento, ocupado, tentar depois.',
  competitor: 'Já usa ou prefere um concorrente.',
  no_need: 'Não vê necessidade ou utilidade.',
  authority: 'Não é a pessoa que decide.',
  other: 'Outra objeção.',
  none: 'Nenhuma objeção na conversa.',
} as const;

export const NEXT_STEP_OPTIONS = {
  meeting: 'Agendar ou confirmar reunião.',
  callback: 'Ligar de novo.',
  not_connected: 'Tentar contato novamente, pois não houve conversa.',
  none: 'Nenhum próximo passo faz sentido.',
} as const;

export interface JevInput {
  transcript: string;
  utterances: Utterance[];
  durationSeconds: number;
  callType: 'inbound' | 'outbound';
}

export interface JevQualification {
  outcome: string;
  interest: string;
  objections: { has_objections: boolean; probability: number; main_type: string };
  nextStepSuggestion: string;
  summary: string;
  answers: unknown;
  confidence: number;
  needsReview: boolean;
  model: string;
  inputTokens: number;
  costUsd: number;
}

export interface JevClient {
  qualify(input: JevInput): Promise<JevQualification>;
}

export class JevError extends Error {}

interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}
interface ScoreAnswer {
  type: 'score';
  score: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}
interface NoulAnswer {
  type: 'noul';
  noul: number;
}
export interface JevResponse {
  model?: string;
  answers?: Record<string, ChoiceAnswer | ScoreAnswer | NoulAnswer | undefined>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function buildJevQuestions() {
  return {
    outcome: {
      type: 'choice',
      instructions: 'Qual foi o desfecho desta ligação de prospecção B2B?',
      criteria: OUTCOME_OPTIONS,
    },
    interest: {
      type: 'score',
      instructions: 'Qual o nível de interesse do cliente no que foi oferecido?',
      criteria: [
        'Nenhum interesse.',
        'Interesse baixo, educado mas frio.',
        'Interesse médio, fez perguntas ou ouviu com atenção.',
        'Interesse alto, quer avançar.',
      ],
    },
    has_objections: {
      type: 'noul',
      instructions: 'O cliente levantou alguma objeção durante a ligação?',
      criteria: { true: 'O cliente apresentou ao menos uma objeção.', false: 'Nenhuma objeção.' },
    },
    objection_type: {
      type: 'choice',
      instructions: 'Qual a principal objeção do cliente?',
      criteria: OBJECTION_OPTIONS,
    },
    next_step_suggestion: {
      type: 'choice',
      instructions: 'Qual o próximo passo mais adequado para o SDR, com base só no que foi dito?',
      criteria: NEXT_STEP_OPTIONS,
    },
  };
}

const OUTCOME_LABEL: Record<string, string> = {
  meeting_booked: 'reunião marcada',
  callback: 'pediu retorno',
  not_connected: 'sem conversa efetiva',
  not_interested: 'sem interesse',
  interested_no_next_step: 'interessado, sem próximo passo',
  other: 'outro desfecho',
};
const INTEREST_LABEL: Record<string, string> = { none: 'nenhum', low: 'baixo', medium: 'médio', high: 'alto' };
const OBJECTION_LABEL: Record<string, string> = {
  price: 'preço',
  timing: 'momento',
  competitor: 'concorrente',
  no_need: 'sem necessidade',
  authority: 'sem poder de decisão',
  other: 'outra',
  none: 'nenhuma',
};
const NEXT_LABEL: Record<string, string> = {
  meeting: 'agendar reunião',
  callback: 'ligar novamente',
  not_connected: 'tentar contato de novo',
  none: 'nenhum',
};

function clip(text: string, max = 160): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Trechos curtos da conversa: as duas primeiras falas e a última. Nada inventado. */
export function transcriptExtract(utterances: Utterance[], transcript: string): string {
  const useful = utterances.filter((u) => u.text.trim().length > 3);
  if (useful.length === 0) return clip(transcript, 240);
  const picks = useful.length <= 3 ? useful : [...useful.slice(0, 2), ...useful.slice(-1)];
  return picks.map((u) => `[${u.speaker}] ${clip(u.text)}`).join(' | ');
}

export function buildSummary(
  q: Pick<JevQualification, 'outcome' | 'interest' | 'objections' | 'nextStepSuggestion'>,
  extract: string,
): string {
  const objection = q.objections.has_objections
    ? `objeção principal: ${OBJECTION_LABEL[q.objections.main_type] ?? q.objections.main_type}`
    : 'sem objeções';
  return (
    `Desfecho: ${OUTCOME_LABEL[q.outcome] ?? q.outcome}. ` +
    `Interesse: ${INTEREST_LABEL[q.interest] ?? q.interest}. ` +
    `${objection[0]?.toUpperCase()}${objection.slice(1)}. ` +
    `Próximo passo sugerido: ${NEXT_LABEL[q.nextStepSuggestion] ?? q.nextStepSuggestion}. ` +
    `Trechos: ${extract}`
  );
}

export function computeJevCostUsd(inputTokens: number): number {
  return Number(((inputTokens / 1_000_000) * JEV_USD_PER_INPUT_MTOK).toFixed(8));
}

/** Mapeia a resposta crua do Jev para o formato da tabela. Pura, sem rede. */
export function mapJevResponse(resp: JevResponse, input: JevInput): JevQualification {
  const a = resp.answers ?? {};
  const outcome = a.outcome?.type === 'choice' ? a.outcome : null;
  const interest = a.interest?.type === 'score' ? a.interest : null;
  const hasObj = a.has_objections?.type === 'noul' ? a.has_objections : null;
  const objType = a.objection_type?.type === 'choice' ? a.objection_type : null;
  const next = a.next_step_suggestion?.type === 'choice' ? a.next_step_suggestion : null;
  if (!outcome || !interest || !hasObj || !next) throw new JevError('jev_incomplete_answers');

  const level = Math.max(0, Math.min(INTEREST_LEVELS.length - 1, Math.round(interest.score)));
  const hasObjections = hasObj.noul >= 0.5;
  const mainType = hasObjections ? (objType?.choice ?? 'other') : 'none';

  // Só entram na confiança as perguntas que valem para esta ligação.
  const confs: number[] = [outcome.confidence, interest.confidence, next.confidence].filter(
    (c): c is number => typeof c === 'number',
  );
  if (hasObjections && typeof objType?.confidence === 'number') confs.push(objType.confidence);
  const confidence = confs.length ? Math.min(...confs) : 0;
  // Noul perto de 0,5 é indecisão.
  const ambiguousNoul = Math.abs(hasObj.noul - 0.5) < 0.15;
  const needsReview = confs.length === 0 || confidence < JEV_LOW_CONFIDENCE || ambiguousNoul;

  const base = {
    outcome: outcome.choice,
    interest: INTEREST_LEVELS[level] as string,
    objections: { has_objections: hasObjections, probability: hasObj.noul, main_type: mainType },
    nextStepSuggestion: next.choice,
  };
  const inputTokens = resp.usage?.input_tokens ?? 0;
  return {
    ...base,
    summary: buildSummary(base, transcriptExtract(input.utterances, input.transcript)),
    answers: { ...resp, usage: resp.usage },
    confidence,
    needsReview,
    model: resp.model ?? JEV_MODEL,
    inputTokens,
    costUsd: computeJevCostUsd(inputTokens),
  };
}

interface Options {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Chave: JEV_API_KEY, com TYPESAFE_API_KEY como apelido. Nunca logada. */
export function resolveJevApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.JEV_API_KEY || env.TYPESAFE_API_KEY || null;
}

export function createJevClient(opts: Options): JevClient {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async qualify(input) {
      const res = await doFetch(JEV_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: JEV_MODEL,
          state: {
            transcript: input.transcript,
            utterances: input.utterances,
            duration_seconds: input.durationSeconds,
            call_type: input.callType,
          },
          questions: buildJevQuestions(),
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
      if (!res.ok) throw new JevError(`jev_http_${res.status}`);
      return mapJevResponse((await res.json()) as JevResponse, input);
    },
  };
}
