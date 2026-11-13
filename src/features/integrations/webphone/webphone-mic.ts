// Permissão do microfone do webphone. Módulo PURO (sem JsSIP, sem estado).
//
// O prompt do navegador só pode abrir a partir de um clique do SDR (Ligar,
// iniciar o Power Dialer ou "Tentar de novo" no painel): pedir no mount
// dispara o prompt sem gesto, o Chrome passa a ignorar ou bloquear e o SDR não
// tem como tentar de novo sem recarregar. A exceção é a permissão JÁ concedida
// (`navigator.permissions` diz `granted`): aí o `getUserMedia` não abre prompt
// e pode rodar no start. O pedido aqui serve só para obter a permissão: as
// faixas são paradas na hora e o JsSIP pede o microfone de novo no `answer`.

/**
 * - `unknown`: ainda não pedimos nesta aba (o pedido sai no clique em Ligar).
 * - `granted`: liberado.
 * - `denied`: o navegador (ou o SDR) bloqueou.
 * - `unavailable`: permissão não é o problema; não há microfone ou outro app está usando.
 */
export type MicPermission = 'unknown' | 'granted' | 'denied' | 'unavailable';

export const MIC_MESSAGES = {
  unknown: 'Ative o microfone para ligar: clique em Ligar e permita o microfone quando o navegador pedir.',
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

/** Pedaço de `navigator.permissions` que usamos (injetável nos testes). */
export interface MicPermissionsApi {
  query(descriptor: { name: string }): Promise<{ state: string }>;
}

/**
 * O navegador já liberou o microfone para este site? Só `granted` conta: com
 * `prompt` ou `denied`, sem a API (Safari antigo) ou se a consulta lançar
 * (Firefox antigo não conhece o nome `microphone`), a resposta é `false` e o
 * pedido fica para o próximo clique. Nunca lança.
 */
export async function isMicrophonePermissionGranted(permissions: MicPermissionsApi | null | undefined): Promise<boolean> {
  if (!permissions || typeof permissions.query !== 'function') return false;
  try {
    const status = await permissions.query({ name: 'microphone' });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}
