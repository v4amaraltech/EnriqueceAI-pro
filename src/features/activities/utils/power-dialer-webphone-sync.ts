/**
 * O Power Dialer não trata o retorno do POST /calls como prova de que o
 * webphone desta aba entrou na ligação. A sessão integrada precisa trazer o
 * dialToken reservado neste clique (PR 562). Outra sessão, outro token ou só
 * o aceite do provedor não liberam a próxima discagem.
 *
 * O intervalo de 15 s não define "conectado". Ele só segura UMA nova tentativa
 * depois de um 424 em que a operadora não criou chamada, porque o ramal pode
 * seguir ocupado depois do BYE local (originateCall, 21/10/2026). Pedido cujo
 * resultado é desconhecido não entra nessa espera.
 */

export const LOCAL_SESSION_GRACE_MS = 2_000;

/** Folga já documentada em originateCall. Não é um atraso em toda rotação. */
export const RAMAL_RELEASE_WINDOW_MS = 15_000;

export const SESSION_MISSING_MESSAGE =
  'O pedido foi aceito, mas o webphone desta aba não entrou na ligação. Desligue esta tentativa antes de discar de novo.';

export const RAMAL_BUSY_WAIT_MESSAGE =
  'O ramal ainda está ocupado na operadora. A próxima tentativa espera a liberação.';

export const RAMAL_BUSY_PAUSE_MESSAGE =
  'O ramal continua ocupado na operadora. A discagem automática parou para não discar por cima.';

export interface DialSessionSnapshot {
  integrated: boolean;
  phase: string;
  dialToken?: string | null;
}

/** `none`: não é a sessão deste clique. `live`: ela está de pé. `ended`: o BYE dela já chegou. */
export function sessionOfThisDial(
  call: DialSessionSnapshot | null | undefined,
  token: string | null,
): 'none' | 'live' | 'ended' {
  if (!call || !token || !call.integrated || call.dialToken !== token) return 'none';
  return call.phase === 'ended' ? 'ended' : 'live';
}

/**
 * Depois de um 424 (chamada não criada), espera o que falta da folga do ramal
 * e tenta uma vez. Se a folga já passou, ou se essa tentativa já foi usada,
 * para. Não repete um POST cujo resultado não se sabe.
 */
export function nextRamalAttempt(args: {
  sessionEndedAt: number | null;
  now: number;
  alreadyRetried: boolean;
}): { action: 'wait'; waitMs: number } | { action: 'pause' } {
  if (args.alreadyRetried) return { action: 'pause' };
  const anchor = args.sessionEndedAt ?? args.now;
  const remaining = anchor + RAMAL_RELEASE_WINDOW_MS - args.now;
  if (remaining <= 0) return { action: 'pause' };
  return { action: 'wait', waitMs: remaining };
}
