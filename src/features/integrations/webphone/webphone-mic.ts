// Permissão do microfone do webphone. Módulo PURO (sem JsSIP, sem estado).
//
// O `getUserMedia` só pode rodar a partir de um clique do SDR (botão "Ativar
// microfone" do painel): pedir no mount dispara o prompt sem gesto, o Chrome
// passa a ignorar ou bloquear e o SDR não tem como tentar de novo sem
// recarregar. O pedido aqui serve só para obter a permissão: as faixas são
// paradas na hora e o JsSIP pede o microfone de novo no `answer`.

/**
 * - `unknown`: ainda não pedimos nesta aba (o SDR precisa clicar).
 * - `granted`: liberado.
 * - `denied`: o navegador (ou o SDR) bloqueou.
 * - `unavailable`: permissão não é o problema; não há microfone ou outro app está usando.
 */
export type MicPermission = 'unknown' | 'granted' | 'denied' | 'unavailable';

export const MIC_MESSAGES = {
  unknown: 'Ative o microfone para ligar: clique em Ativar microfone no aviso do webphone.',
  denied:
    'O navegador bloqueou o microfone. Libere a permissão para o EnriqueceAI e clique em Tentar de novo.',
  unavailable:
    'Não foi possível acessar o microfone. Confira se há um microfone conectado e se outro aplicativo não está usando, e clique em Tentar de novo.',
} as const;

const UNAVAILABLE_ERRORS = new Set([
  'NotFoundError',
  'NotReadableError',
  'OverconstrainedError',
  'AbortError',
]);

/** Nome do erro do `getUserMedia` (`DOMException.name`), ou '' se não houver. */
function errorName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err)
    return String((err as { name: unknown }).name ?? '');
  return '';
}

/**
 * Classifica a falha do `getUserMedia`. `NotAllowedError`/`SecurityError` são
 * bloqueio; falta de dispositivo ou dispositivo ocupado é `unavailable`.
 * Qualquer outro erro conta como `denied`: é o lado conservador (impede
 * ligação sem áudio) e a mensagem orienta a tentar de novo.
 */
export function classifyMicError(err: unknown): 'denied' | 'unavailable' {
  return UNAVAILABLE_ERRORS.has(errorName(err)) ? 'unavailable' : 'denied';
}

export interface MicMediaDevices {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

/**
 * Pede o microfone uma vez e devolve o estado resultante. Para as faixas logo
 * em seguida. Nunca lança. Sem `mediaDevices` (contexto inseguro ou navegador
 * sem WebRTC) o resultado é `unavailable`.
 */
export async function acquireMicrophonePermission(
  mediaDevices: MicMediaDevices | null | undefined,
): Promise<MicPermission> {
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') return 'unavailable';
  try {
    const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
    for (const track of stream.getTracks()) track.stop();
    return 'granted';
  } catch (err) {
    const permission = classifyMicError(err);
    console.warn(`[webphone] microphone ${permission}:`, errorName(err) || 'erro desconhecido');
    return permission;
  }
}
