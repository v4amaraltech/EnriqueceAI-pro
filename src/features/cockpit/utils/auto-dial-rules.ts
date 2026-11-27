import { BR_NATIONAL_HOLIDAYS, brtDateKey } from '@/lib/utils/br-holidays';

/**
 * Regras do motor automático do Cockpit (docs/plans/cockpit-motor-automatico). Módulo PURO:
 * sem rede, sem banco, sem relógio implícito (`now` sempre explícito), determinístico.
 *
 * As constantes são PRÓPRIAS do Cockpit e não vêm da Execução: a regra é decisão do usuário
 * (decisoes.md) e não pode mudar se o Power Dialer mudar.
 */
export const AUTO_DIAL_RULES = {
  /** FR-4 / D-Tentativas: até 3 ligações por lead por dia, de qualquer origem (R-7). */
  maxAttemptsPerDay: 3,
  /** FR-5 / D-Tentativas: pelo menos 1 h entre ligações do mesmo lead. */
  minGapMs: 60 * 60 * 1000,
  /** FR-12 / M-6: 400 ligações do motor por SDR por dia desde o início (era 100 no piloto; parametrizável). */
  dailyCap: 400,
  /** FR-12: o teto pode subir até 400. */
  dailyCapMax: 400,
  /** FR-11 / D11: janela seg-sex, horário de Brasília, 08:00:00 até 19:59:59.999. */
  windowStartHour: 8,
  windowEndHour: 20,
  /** FR-10 / D10: tipos de `contact_holds` que impedem o motor de ligar. */
  blockedHoldTypes: ['total', 'prospeccao'],
} as const;

export interface AutoDialRules {
  maxAttemptsPerDay: number;
  minGapMs: number;
  dailyCap: number;
  dailyCapMax: number;
  windowStartHour: number;
  windowEndHour: number;
  blockedHoldTypes: readonly string[];
}

/** Códigos de recusa estáveis (plano §3.2). */
export type AutoDialRefusalCode =
  | 'outside_hours'
  | 'holiday'
  | 'daily_cap'
  | 'held'
  | 'answered_today'
  | 'attempts'
  | 'gap'
  | 'too_soon';

export const AUTO_DIAL_REFUSAL_MESSAGES: Record<AutoDialRefusalCode, string> = {
  outside_hours: 'Fora do horário (seg–sex 8h–20h, Brasília)',
  holiday: 'Feriado: a discagem não liga',
  daily_cap: 'Teto de ligações da discagem no dia atingido',
  held: 'Lead com bloqueio de contato',
  answered_today: 'Lead já conversou hoje',
  attempts: 'Lead já teve as tentativas do dia',
  gap: 'Lead ligado há menos de 1 h',
  too_soon: 'Há uma ligação sua em curso ou recém-iniciada',
};

export type AutoDialDecision =
  | { allowed: true }
  | { allowed: false; code: AutoDialRefusalCode; message: string; releaseAt?: number };

const BRT_OFFSET_MS = 3 * 3600 * 1000; // BRT = UTC-3 fixo, sem horário de verão (mesma base de br-holidays.ts)
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const refuse = (code: AutoDialRefusalCode, releaseAt?: number): AutoDialDecision => ({
  allowed: false,
  code,
  message: AUTO_DIAL_REFUSAL_MESSAGES[code],
  ...(releaseAt === undefined ? {} : { releaseAt }),
});

function toMs(value: Date | number | string): number {
  return value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
}

/** Dia da semana (0 = domingo) e milissegundos desde 00:00 BRT. */
function brtClock(now: Date): { dow: number; msOfDay: number } {
  const shifted = now.getTime() - BRT_OFFSET_MS;
  return { dow: new Date(shifted).getUTCDay(), msOfDay: ((shifted % DAY_MS) + DAY_MS) % DAY_MS };
}

/** Início do dia de Brasília (00:00 BRT) que contém `now`, em ms. Base da contagem diária. */
export function brtStartOfDay(now: Date): number {
  const shifted = now.getTime() - BRT_OFFSET_MS;
  return shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) + BRT_OFFSET_MS;
}

/**
 * FR-11: seg–sex, 08:00:00 ≤ hora BRT < 20:00:00, e dia que não seja feriado (C-1).
 * `holidays` são datas BRT `YYYY-MM-DD` recebidas de fora (padrão: a lista nacional do app).
 * Fim de semana → `outside_hours`; feriado em dia útil → `holiday` (vale o dia todo).
 */
export function isWithinDialWindow(
  now: Date,
  holidays: ReadonlySet<string> | readonly string[] = Object.keys(BR_NATIONAL_HOLIDAYS),
  rules: Pick<AutoDialRules, 'windowStartHour' | 'windowEndHour'> = AUTO_DIAL_RULES,
): AutoDialDecision {
  const { dow, msOfDay } = brtClock(now);
  if (dow === 0 || dow === 6) return refuse('outside_hours');
  const list = holidays instanceof Set ? holidays : new Set(holidays);
  if (list.has(brtDateKey(now))) return refuse('holiday');
  if (msOfDay < rules.windowStartHour * HOUR_MS || msOfDay >= rules.windowEndHour * HOUR_MS) return refuse('outside_hours');
  return { allowed: true };
}

/** FR-12: teto efetivo (nunca acima de `dailyCapMax`). */
export function effectiveDailyCap(rules: Pick<AutoDialRules, 'dailyCap' | 'dailyCapMax'> = AUTO_DIAL_RULES): number {
  return Math.min(rules.dailyCap, rules.dailyCapMax);
}

/** FR-12: o SDR já fez o teto de ligações DO MOTOR hoje (Execução e manuais não contam, C-2). */
export function isDailyCapReached(
  motorCallsToday: number,
  rules: Pick<AutoDialRules, 'dailyCap' | 'dailyCapMax'> = AUTO_DIAL_RULES,
): boolean {
  return motorCallsToday >= effectiveDailyCap(rules);
}

/** Dados do lead que as regras precisam; o servidor monta a partir de `calls` e `contact_holds`. */
export interface LeadDialStats {
  /** Ligações de hoje (dia BRT), de QUALQUER origem, atendidas inclusive (FR-4, R-7). */
  callsToday: number;
  /** Última ligação de qualquer origem (ISO, ms ou Date); null = nunca. */
  lastCallAt: Date | number | string | null;
  /**
   * Teve CONVERSA REAL hoje, de qualquer origem (FR-9b, M-1: altera a C-3). Caixa postal e atendimento curto NÃO são
   * conversa: contam como tentativa e o lead volta à fila (ver `isRealConversation`).
   */
  conversationToday: boolean;
  /** Tipos de `contact_holds` do lead (FR-10). */
  holdTypes: readonly string[];
  /**
   * Há um RETORNO vencido e ainda não atendido deste lead (`scheduled_activities`, telefone, pendente) — FR-23, A-D2.
   * O retorno fura "conversa hoje" e o intervalo de 1 h, mas NÃO fura bloqueio, as 3 tentativas, janela, feriado nem teto.
   */
  callbackDue?: boolean;
}

/**
 * FR-4/5/9b/10: o lead pode ser discado agora? Ordem de recusa: bloqueio, atendido hoje,
 * tentativas, intervalo. `releaseAt` (ms) só vem em `gap`: quando o lead fica liberado.
 */
export function evaluateLeadEligibility(
  lead: LeadDialStats,
  now: Date,
  rules: AutoDialRules = AUTO_DIAL_RULES,
): AutoDialDecision {
  if (lead.holdTypes.some((t) => rules.blockedHoldTypes.includes(t))) return refuse('held');
  if (lead.conversationToday && !lead.callbackDue) return refuse('answered_today');
  if (lead.callsToday >= rules.maxAttemptsPerDay) return refuse('attempts');
  if (lead.lastCallAt !== null && !lead.callbackDue) {
    const releaseAt = toMs(lead.lastCallAt) + rules.minGapMs;
    if (now.getTime() < releaseAt) return refuse('gap', releaseAt);
  }
  return { allowed: true };
}

/**
 * Decisão completa para discar: janela/feriado → teto do motor → lead. Falha na PRIMEIRA
 * regra que recusar, com código estável (NFR-3/NFR-4: quem chama deve tratar erro de leitura como recusa).
 */
export function evaluateAutoDial(input: {
  now: Date;
  motorCallsToday: number;
  lead: LeadDialStats;
  holidays?: ReadonlySet<string> | readonly string[];
  rules?: AutoDialRules;
}): AutoDialDecision {
  const rules = input.rules ?? AUTO_DIAL_RULES;
  const window = isWithinDialWindow(input.now, input.holidays, rules);
  if (!window.allowed) return window;
  if (isDailyCapReached(input.motorCallsToday, rules)) return refuse('daily_cap');
  return evaluateLeadEligibility(input.lead, input.now, rules);
}

/**
 * FR-5 (estado Aguardando): quando o primeiro lead recusado SÓ pelo intervalo fica liberado (ms).
 * `null` se nenhum está esperando só pelo intervalo.
 */
export function nextReleaseAt(leads: readonly LeadDialStats[], now: Date, rules: AutoDialRules = AUTO_DIAL_RULES): number | null {
  let best: number | null = null;
  for (const lead of leads) {
    const d = evaluateLeadEligibility(lead, now, rules);
    if (!d.allowed && d.code === 'gap' && d.releaseAt !== undefined && (best === null || d.releaseAt < best)) best = d.releaseAt;
  }
  return best;
}

/**
 * FR-6/FR-7: a ligação que não atendeu é a última tentativa do dia? `attemptNo` = quantas ligações
 * o lead tem hoje, contando esta. Só na última grava `no_answer` (D6).
 */
export function isLastAttemptOfDay(attemptNo: number, rules: Pick<AutoDialRules, 'maxAttemptsPerDay'> = AUTO_DIAL_RULES): boolean {
  return attemptNo >= rules.maxAttemptsPerDay;
}

/**
 * Trava suave por USUÁRIO contra disparo duplo (duas abas, cliques rápidos): sem lock no banco, o servidor recusa discar se
 * o próprio usuário tem uma ligação criada há menos de `minSinceLastCallMs`, ou uma ligação DO MOTOR ainda sem término
 * (`hangup_cause` vazio) criada nos últimos `ongoingMaxAgeMs`. O teto de idade evita travar para sempre se o webhook nunca chegar.
 */
export const DIAL_SPACING = {
  minSinceLastCallMs: 20_000,
  ongoingMaxAgeMs: 20 * 60_000,
} as const;

export interface RecentUserCall {
  created_at: Date | number | string;
  hangup_cause: string | null;
  /** A ligação tem o marcador `metadata.cockpit_auto_dial` (é do motor). */
  isMotor: boolean;
}

/** `too_soon` (falha fechada) se o usuário já tem ligação recente ou ligação do motor sem término. */
export function evaluateDialSpacing(calls: readonly RecentUserCall[], now: Date, spacing: typeof DIAL_SPACING = DIAL_SPACING): AutoDialDecision {
  for (const c of calls) {
    const age = now.getTime() - toMs(c.created_at);
    if (age < spacing.minSinceLastCallMs) return refuse('too_soon');
    if (c.isMotor && !c.hangup_cause && age < spacing.ongoingMaxAgeMs) return refuse('too_soon');
  }
  return { allowed: true };
}

/**
 * "Ligar de novo" (ligação que caiu no meio da conversa): até quanto tempo depois de a ligação anterior ser CRIADA o
 * servidor aceita religar fora das regras de repetição. 60 min cobre uma conversa longa mais a internet voltar, e não
 * abre um passe livre: passado o prazo, valem as regras normais.
 */
export const REDIAL_WINDOW_MS = 60 * 60 * 1000;
