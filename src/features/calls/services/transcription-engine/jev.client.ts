import type { Utterance } from './assemblyai.client';
import {
  JEV_HIGH_CONFIDENCE,
  JEV_LOW_CONFIDENCE,
  JEV_MODEL,
  JEV_NOUL_UNDECIDED_BAND,
  JEV_URL,
  JEV_USD_PER_INPUT_MTOK,
} from './constants';

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

/** Perguntas de ICP da V4 (opcionais). Chaves estáveis em `answers`. */
export const REVENUE_OPTIONS = {
  below_150k: 'Faturamento mensal estimado abaixo de R$ 150 mil.',
  above_150k: 'Faturamento mensal estimado acima de R$ 150 mil.',
  not_mentioned: 'Faturamento não foi mencionado.',
} as const;

export const HEADCOUNT_OPTIONS = {
  up_to_5: 'Empresa com até 5 funcionários.',
  over_5: 'Empresa com mais de 5 funcionários.',
  not_mentioned: 'Porte ou número de funcionários não mencionado.',
} as const;

export const DIGITAL_MATURITY_OPTIONS = {
  low: 'Maturidade digital baixa: pouca presença online, sem processos ou ferramentas.',
  medium: 'Maturidade digital média: alguma presença e ferramentas, mas sem estratégia clara.',
  high: 'Maturidade digital alta: já investe em marketing digital, mídia paga e métricas.',
  unknown: 'Não dá para saber a maturidade digital.',
} as const;

export const DECISION_MAKER_OPTIONS = {
  yes: 'A pessoa na ligação é quem decide a contratação.',
  no: 'A pessoa na ligação não decide.',
  uncertain: 'Não ficou claro se a pessoa decide.',
} as const;

export const BANT_OPTIONS = {
  budget: {
    yes: 'Há orçamento ou disposição de investir.',
    no: 'Não há orçamento.',
    not_mentioned: 'Orçamento não mencionado.',
  },
  authority: {
    yes: 'Há autoridade de decisão na conversa.',
    no: 'Sem autoridade de decisão.',
    not_mentioned: 'Autoridade não mencionada.',
  },
  need: {
    yes: 'O cliente demonstrou necessidade clara.',
    no: 'O cliente não tem necessidade.',
    not_mentioned: 'Necessidade não mencionada.',
  },
  timeline: {
    yes: 'Há prazo ou urgência definidos.',
    no: 'Sem prazo ou urgência.',
    not_mentioned: 'Prazo não mencionado.',
  },
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
    monthly_revenue: {
      type: 'choice',
      instructions:
        'O faturamento mensal estimado da empresa foi mencionado? Ele fica abaixo ou acima de R$ 150 mil?',
      criteria: REVENUE_OPTIONS,
    },
    headcount: {
      type: 'choice',
      instructions: 'Qual o porte da empresa em número de funcionários, segundo o que foi dito?',
      criteria: HEADCOUNT_OPTIONS,
    },
    digital_maturity: {
      type: 'choice',
      instructions: 'Qual a maturidade digital da empresa, com base só no que foi dito?',
      criteria: DIGITAL_MATURITY_OPTIONS,
    },
    decision_maker: {
      type: 'choice',
      instructions: 'A pessoa que atendeu a ligação é quem decide a contratação?',
      criteria: DECISION_MAKER_OPTIONS,
    },
    bant_budget: {
      type: 'choice',
      instructions: 'BANT, orçamento: o cliente tem orçamento ou disposição de investir?',
      criteria: BANT_OPTIONS.budget,
    },
    bant_authority: {
      type: 'choice',
      instructions: 'BANT, autoridade: há poder de decisão na conversa?',
      criteria: BANT_OPTIONS.authority,
    },
    bant_need: {
      type: 'choice',
      instructions: 'BANT, necessidade: o cliente demonstrou necessidade real?',
      criteria: BANT_OPTIONS.need,
    },
    bant_timeline: {
      type: 'choice',
      instructions: 'BANT, prazo: há prazo ou urgência para decidir?',
      criteria: BANT_OPTIONS.timeline,
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
const INTEREST_LABEL: Record<string, string> = {
  none: 'nenhum',
  low: 'baixo',
  medium: 'médio',
  high: 'alto',
};
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

export interface IcpAnswers {
  monthlyRevenue?: string;
  headcount?: string;
  digitalMaturity?: string;
  decisionMaker?: string;
  bant?: { budget?: string; authority?: string; need?: string; timeline?: string };
}

const REVENUE_LABEL: Record<string, string> = {
  below_150k: 'abaixo de R$ 150 mil/mês',
  above_150k: 'acima de R$ 150 mil/mês',
};
const HEADCOUNT_LABEL: Record<string, string> = {
  up_to_5: 'até 5 funcionários',
  over_5: 'mais de 5 funcionários',
};
const MATURITY_LABEL: Record<string, string> = { low: 'baixa', medium: 'média', high: 'alta' };
const DECISION_LABEL: Record<string, string> = { yes: 'sim', no: 'não', uncertain: 'incerto' };
const BANT_YN_LABEL: Record<string, string> = { yes: 'sim', no: 'não' };

/** Trecho de ICP só com valores úteis; vazio se tudo for "não mencionado". */
export function buildIcpSummary(icp: IcpAnswers | undefined): string {
  if (!icp) return '';
  const parts: string[] = [];
  const revenue = icp.monthlyRevenue && REVENUE_LABEL[icp.monthlyRevenue];
  if (revenue) parts.push(`faturamento ${revenue}`);
  const headcount = icp.headcount && HEADCOUNT_LABEL[icp.headcount];
  if (headcount) parts.push(`porte ${headcount}`);
  const maturity = icp.digitalMaturity && MATURITY_LABEL[icp.digitalMaturity];
  if (maturity) parts.push(`maturidade digital ${maturity}`);
  const decision = icp.decisionMaker && DECISION_LABEL[icp.decisionMaker];
  if (decision) parts.push(`decisor na ligação: ${decision}`);
  const bantNames: Array<[keyof NonNullable<IcpAnswers['bant']>, string]> = [
    ['budget', 'orçamento'],
    ['authority', 'autoridade'],
    ['need', 'necessidade'],
    ['timeline', 'prazo'],
  ];
  const bant = bantNames
    .map(([k, label]) => {
      const v = icp.bant?.[k];
      const text = v && BANT_YN_LABEL[v];
      return text ? `${label} ${text}` : null;
    })
    .filter((x): x is string => x !== null);
  if (bant.length) parts.push(`BANT: ${bant.join(', ')}`);
  return parts.length ? `ICP: ${parts.join('; ')}. ` : '';
}

export function buildSummary(
  q: Pick<JevQualification, 'outcome' | 'interest' | 'objections' | 'nextStepSuggestion'>,
  extract: string,
  icp?: IcpAnswers,
): string {
  const objection = q.objections.has_objections
    ? `objeção principal: ${OBJECTION_LABEL[q.objections.main_type] ?? q.objections.main_type}`
    : 'sem objeções';
  return (
    `Desfecho: ${OUTCOME_LABEL[q.outcome] ?? q.outcome}. ` +
    `Interesse: ${INTEREST_LABEL[q.interest] ?? q.interest}. ` +
    `${objection[0]?.toUpperCase()}${objection.slice(1)}. ` +
    `Próximo passo sugerido: ${NEXT_LABEL[q.nextStepSuggestion] ?? q.nextStepSuggestion}. ` +
    buildIcpSummary(icp) +
    `Trechos: ${extract}`
  );
}

export function computeJevCostUsd(inputTokens: number): number {
  return Number(((inputTokens / 1_000_000) * JEV_USD_PER_INPUT_MTOK).toFixed(8));
}

function optionalChoice(
  answers: NonNullable<JevResponse['answers']>,
  key: string,
): string | undefined {
  const v = answers[key];
  return v?.type === 'choice' ? v.choice : undefined;
}

/** ICP é opcional: se o Jev não devolver, fica vazio e nada lança. */
function icpFromAnswers(a: NonNullable<JevResponse['answers']>): IcpAnswers {
  return {
    monthlyRevenue: optionalChoice(a, 'monthly_revenue'),
    headcount: optionalChoice(a, 'headcount'),
    digitalMaturity: optionalChoice(a, 'digital_maturity'),
    decisionMaker: optionalChoice(a, 'decision_maker'),
    bant: {
      budget: optionalChoice(a, 'bant_budget'),
      authority: optionalChoice(a, 'bant_authority'),
      need: optionalChoice(a, 'bant_need'),
      timeline: optionalChoice(a, 'bant_timeline'),
    },
  };
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

  const outcomeConf = outcome.confidence;
  const nextConf = next.confidence;
  const hasConf = (c: number | undefined): c is number => typeof c === 'number';
  const outcomeNextHigh =
    hasConf(outcomeConf) &&
    hasConf(nextConf) &&
    outcomeConf >= JEV_HIGH_CONFIDENCE &&
    nextConf >= JEV_HIGH_CONFIDENCE;

  // Só entram na confiança as perguntas que valem para esta ligação.
  const confs: number[] = [outcomeConf, nextConf, interest.confidence].filter(hasConf);
  // Com outcome e next_step altos, objection_type não puxa a confiança para baixo.
  if (!outcomeNextHigh && hasObjections && hasConf(objType?.confidence))
    confs.push(objType.confidence);
  const confidence = confs.length ? Math.min(...confs) : 0;

  let needsReview: boolean;
  if (
    !hasConf(outcomeConf) ||
    outcomeConf < JEV_LOW_CONFIDENCE ||
    !hasConf(nextConf) ||
    nextConf < JEV_LOW_CONFIDENCE
  ) {
    needsReview = true;
  } else if (outcomeNextHigh) {
    needsReview = false;
  } else {
    // Regra conservadora: confiança baixa em qualquer pergunta ou noul indeciso (perto de 0,5).
    const ambiguousNoul = Math.abs(hasObj.noul - 0.5) < JEV_NOUL_UNDECIDED_BAND;
    needsReview = confs.length === 0 || confidence < JEV_LOW_CONFIDENCE || ambiguousNoul;
  }

  const base = {
    outcome: outcome.choice,
    interest: INTEREST_LEVELS[level] as string,
    objections: { has_objections: hasObjections, probability: hasObj.noul, main_type: mainType },
    nextStepSuggestion: next.choice,
  };
  const inputTokens = resp.usage?.input_tokens ?? 0;
  return {
    ...base,
    summary: buildSummary(
      base,
      transcriptExtract(input.utterances, input.transcript),
      icpFromAnswers(a),
    ),
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
