import { RAMAL_RELEASE_WINDOW_MS } from '@/features/activities/utils/power-dialer-webphone-sync';

/**
 * Discador FALSO e PURO (FR-18, modo simulado). Decide o resultado de uma "ligação" sem rede:
 * não chama a API4COM, não cria linha em `calls`, sem relógio e sem aleatoriedade (mesma entrada,
 * mesmo resultado). Serve ao modo simulado do motor e aos testes.
 */

export type SimulatedOutcome = 'answered' | 'no_answer' | 'ramal_busy' | 'dial_failed';

/** Roteiro: um resultado fixo, uma lista que cicla pela tentativa, ou um mapa por lead (`'*'` = padrão). */
export type SimulatedScript =
  | SimulatedOutcome
  | readonly SimulatedOutcome[]
  | Readonly<Record<string, SimulatedOutcome | readonly SimulatedOutcome[]>>;

/** Duração fictícia até a "ligação" terminar. */
export const SIMULATED_CALL_DURATION_MS = 8_000;

export const SIMULATED_FAILURE_MESSAGE = 'Falha simulada ao discar';

export type SimulatedDialResult =
  | { kind: 'started'; simulated: true; callId: string; answered: boolean; endsAfterMs: number }
  /** Igual ao 424 real: a chamada não nasceu; espera a folga do ramal e tenta uma vez. */
  | { kind: 'ramal_busy'; simulated: true; retryAfterMs: number }
  | { kind: 'failed'; simulated: true; message: string };

const DEFAULT_OUTCOME: SimulatedOutcome = 'no_answer';

function pickFromList(list: SimulatedOutcome | readonly SimulatedOutcome[], attemptNo: number): SimulatedOutcome {
  if (typeof list === 'string') return list;
  if (list.length === 0) return DEFAULT_OUTCOME;
  const idx = ((Math.max(1, attemptNo) - 1) % list.length + list.length) % list.length;
  return list[idx] ?? DEFAULT_OUTCOME;
}

/** Resultado do roteiro para este lead e tentativa (`attemptNo` começa em 1). */
export function resolveSimulatedOutcome(script: SimulatedScript, leadId: string, attemptNo: number): SimulatedOutcome {
  if (typeof script === 'string' || Array.isArray(script)) return pickFromList(script as SimulatedOutcome | readonly SimulatedOutcome[], attemptNo);
  const byLead = script as Readonly<Record<string, SimulatedOutcome | readonly SimulatedOutcome[]>>;
  const entry = byLead[leadId] ?? byLead['*'];
  return entry === undefined ? DEFAULT_OUTCOME : pickFromList(entry, attemptNo);
}

/** "Discar" de mentira. O id é determinístico (`sim-<lead>-<tentativa>`) e nunca colide com um id real. */
export function simulateDial(input: { leadId: string; attemptNo: number; script: SimulatedScript }): SimulatedDialResult {
  const outcome = resolveSimulatedOutcome(input.script, input.leadId, input.attemptNo);
  switch (outcome) {
    case 'ramal_busy':
      return { kind: 'ramal_busy', simulated: true, retryAfterMs: RAMAL_RELEASE_WINDOW_MS };
    case 'dial_failed':
      return { kind: 'failed', simulated: true, message: SIMULATED_FAILURE_MESSAGE };
    case 'answered':
    case 'no_answer':
      return {
        kind: 'started',
        simulated: true,
        callId: `sim-${input.leadId}-${input.attemptNo}`,
        answered: outcome === 'answered',
        endsAfterMs: SIMULATED_CALL_DURATION_MS,
      };
  }
}
