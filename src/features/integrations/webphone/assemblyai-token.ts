import {
  assemblyAiHosts,
  assemblyAiTokenBody,
  assemblyAiWebsocketUrl,
  readAssemblyAiToken,
} from './assemblyai-streaming';

export interface MintedAssemblyAiToken {
  token: string;
  expiresInSeconds: number;
  websocketUrl: string;
}

/**
 * Troca ASSEMBLYAI_API_KEY por um token curto. Sem a chave, devolve null e o
 * webphone segue como hoje. A chave só sai no header desta chamada.
 */
export async function mintAssemblyAiToken(fetchImpl: typeof fetch = fetch): Promise<MintedAssemblyAiToken | null> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) return null;
  const hosts = assemblyAiHosts(process.env.ASSEMBLYAI_STREAMING_REGION);
  try {
    const response = await fetchImpl(`${hosts.tokenHttp}/v1/token`, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: assemblyAiTokenBody(),
    });
    if (!response.ok) {
      console.error('[webphone-live-amd] token recusado:', response.status);
      return null;
    }
    const minted = readAssemblyAiToken(await response.json());
    if (!minted) return null;
    return { ...minted, websocketUrl: assemblyAiWebsocketUrl(hosts.streamingWs, minted.token) };
  } catch (err) {
    console.error('[webphone-live-amd] falha ao emitir token:', err);
    return null;
  }
}
