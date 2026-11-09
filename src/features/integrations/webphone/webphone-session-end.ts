/** Sessão SIP desta aba, no que importa para saber se a discagem atual já caiu. */
export interface BrowserCallEndSignal {
  integrated: boolean;
  phase: string;
  startedAt: number;
}

/**
 * A sessão integrada que começou nesta discagem já recebeu o BYE.
 * Uma sessão anterior (startedAt anterior ao clique) não encerra a chamada nova.
 */
export function integratedSessionEndedThisDial(
  call: BrowserCallEndSignal | null | undefined,
  dialStartedAt: number | null,
): boolean {
  return Boolean(
    call && call.integrated && call.phase === 'ended' && dialStartedAt !== null && call.startedAt >= dialStartedAt,
  );
}
