// Endereços e parâmetros do streaming da AssemblyAI.
// Português: o modelo universal-streaming-multilingual aceita pt (não existe
// código pt-BR). language_codes é só dos modelos Pro, então não entra aqui.
// Fontes (consultadas em 10/11/2026):
// https://www.assemblyai.com/docs/streaming/select-the-speech-model
// https://www.assemblyai.com/docs/streaming/multilingual-transcription
// https://www.assemblyai.com/docs/streaming/api-spec/streaming-websocket
// https://www.assemblyai.com/docs/temporary-tokens

export const LIVE_AMD_SPEECH_MODEL = 'universal-streaming-multilingual';
export const LIVE_AMD_SAMPLE_RATE = 16_000;
export const LIVE_AMD_WINDOW_MS = 15_000;
export const LIVE_AMD_TOKEN_TTL_SECONDS = 60;
export const LIVE_AMD_MAX_SESSION_SECONDS = 1_800;

export interface AssemblyAiHosts {
  tokenHttp: string;
  streamingWs: string;
}

/** Região vazia usa o host mais próximo. `eu` e `us` fixam a residência do áudio. */
export function assemblyAiHosts(region: string | undefined): AssemblyAiHosts {
  if (region === 'eu') {
    return { tokenHttp: 'https://token.eu.assemblyai.com', streamingWs: 'wss://streaming.eu.assemblyai.com' };
  }
  if (region === 'us') {
    return { tokenHttp: 'https://token.us.assemblyai.com', streamingWs: 'wss://streaming.us.assemblyai.com' };
  }
  return { tokenHttp: 'https://token.assemblyai.com', streamingWs: 'wss://streaming.assemblyai.com' };
}

export function assemblyAiTokenBody(): string {
  return JSON.stringify({
    product: 'streaming',
    expires_in_seconds: LIVE_AMD_TOKEN_TTL_SECONDS,
    max_session_duration_seconds: LIVE_AMD_MAX_SESSION_SECONDS,
  });
}

/** URL do WebSocket com o token curto. A chave permanente não entra aqui. */
export function assemblyAiWebsocketUrl(streamingWs: string, token: string): string {
  const url = new URL(`${streamingWs}/v3/ws`);
  url.searchParams.set('token', token);
  url.searchParams.set('speech_model', LIVE_AMD_SPEECH_MODEL);
  url.searchParams.set('encoding', 'pcm_s16le');
  url.searchParams.set('sample_rate', String(LIVE_AMD_SAMPLE_RATE));
  return url.toString();
}

export function readAssemblyAiToken(payload: unknown): { token: string; expiresInSeconds: number } | null {
  if (!payload || typeof payload !== 'object') return null;
  const token = (payload as { token?: unknown }).token;
  if (typeof token !== 'string' || token.length === 0) return null;
  const expires = (payload as { expires_in_seconds?: unknown }).expires_in_seconds;
  return {
    token,
    expiresInSeconds: typeof expires === 'number' && expires > 0 ? expires : LIVE_AMD_TOKEN_TTL_SECONDS,
  };
}
