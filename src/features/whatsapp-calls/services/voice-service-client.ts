/**
 * Client server-side do microserviço de voz WhatsApp (Epic 7 / story 7.1, base
 * WaCalls). TODA a comunicação com o serviço passa por aqui — a API key vive só
 * no servidor (env WACALLS_API_KEY) e nunca chega ao browser.
 *
 * Este módulo ISOLA os detalhes de fio do serviço (shapes de request/response,
 * mapeamento de status, entrega do QR). Quando o 7.1 existir com o contrato
 * final, só este arquivo muda — as Server Actions e a UI consomem os tipos
 * normalizados abaixo.
 *
 * Endpoints consumidos (ver docs/plans/whatsapp-call-activity-plan.md §0.4):
 *   POST   /api/sessions               -> cria conta + inicia pareamento (QR)
 *   GET    /api/sessions               -> lista contas (id, jid, status, paired)
 *   POST   /api/sessions/{sid}/pair    -> novo QR (re-pareamento)
 */
import { getEnv } from '@/config/env';

import type { WhatsAppCallSessionStatus } from '../types';

export class VoiceServiceError extends Error {
  constructor(
    message: string,
    readonly code: 'not_configured' | 'request_failed' | 'not_found',
  ) {
    super(message);
    this.name = 'VoiceServiceError';
  }
}

export interface VoiceSession {
  sid: string;
  status: WhatsAppCallSessionStatus;
  /** Número pareado (JID normalizado) — null enquanto não pareado. */
  phoneNumber: string | null;
  /** QR de pareamento (data URL ou string), quando disponível. */
  qr: string | null;
}

export function isVoiceServiceConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.WACALLS_BASE_URL && env.WACALLS_API_KEY);
}

function config(): { baseUrl: string; apiKey: string } {
  const env = getEnv();
  if (!env.WACALLS_BASE_URL || !env.WACALLS_API_KEY) {
    throw new VoiceServiceError(
      'Serviço de voz WhatsApp não configurado (WACALLS_BASE_URL/WACALLS_API_KEY).',
      'not_configured',
    );
  }
  return { baseUrl: env.WACALLS_BASE_URL.replace(/\/$/, ''), apiKey: env.WACALLS_API_KEY };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, apiKey } = config();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        ...(init?.headers ?? {}),
      },
      // Timeout de 15s — serviço de voz lento não pode travar a Server Action.
      signal: init?.signal ?? AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  } catch (err) {
    throw new VoiceServiceError(
      `Falha ao contatar o serviço de voz: ${err instanceof Error ? err.message : 'erro de rede'}`,
      'request_failed',
    );
  }
  if (!res.ok) {
    throw new VoiceServiceError(`Serviço de voz respondeu ${res.status}`, 'request_failed');
  }
  return (await res.json().catch(() => ({}))) as T;
}

// --- Normalização (defensiva — shapes do WaCalls não são garantidos) ----------

interface RawSession {
  id?: string;
  sid?: string;
  jid?: string | null;
  status?: string | null;
  /** whatsmeow connection state ('open' | 'qr' | 'close' | ...) — campo real do AstraCalls. */
  state?: string | null;
  paired?: boolean;
  qr?: string | null;
  qrCode?: string | null;
  code?: string | null;
}

function mapStatus(raw: RawSession): WhatsAppCallSessionStatus {
  if (raw.paired === true) return 'connected';
  const s = (raw.status ?? raw.state ?? '').toLowerCase();
  if (s === 'disconnected' || s === 'logged_out' || s === 'loggedout' || s === 'close') {
    return 'disconnected';
  }
  // Em pareamento (tem QR) ou estado intermediário.
  return 'pairing';
}

function jidToPhone(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const digits = jid.split('@')[0]?.replace(/\D/g, '') ?? '';
  return digits || null;
}

function normalize(raw: RawSession): VoiceSession {
  return {
    sid: raw.sid ?? raw.id ?? '',
    status: mapStatus(raw),
    phoneNumber: jidToPhone(raw.jid),
    qr: raw.qr ?? raw.qrCode ?? raw.code ?? null,
  };
}

// --- API pública --------------------------------------------------------------

/** Cria uma sessão e inicia o pareamento (QR). `name` identifica o SDR no serviço. */
export async function createVoiceSession(name: string): Promise<VoiceSession> {
  const raw = await request<RawSession>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return normalize(raw);
}

/** Busca o estado atual de uma sessão pelo sid. Retorna null se não existir. */
export async function getVoiceSession(sid: string): Promise<VoiceSession | null> {
  const list = await request<RawSession[]>('/api/sessions', { method: 'GET' });
  const found = (Array.isArray(list) ? list : []).find((s) => (s.sid ?? s.id) === sid);
  return found ? normalize(found) : null;
}

/** Remove uma sessão (conta) do serviço — limpa pareamentos abandonados/mortos. */
export async function deleteVoiceSession(sid: string): Promise<void> {
  await request<unknown>(`/api/sessions/${encodeURIComponent(sid)}`, { method: 'DELETE' });
}

// --- Chamadas (story 7.5) ------------------------------------------------------

// Resposta real do serviço: { call: { callId } } (confirmado no cliente AstraCalls).
interface RawCall {
  call?: { callId?: string };
  call_id?: string;
  id?: string;
}

/** Inicia uma chamada de saída na sessão. Retorna o id da chamada no serviço. */
export async function startVoiceCall(
  sid: string,
  phone: string,
  record = false,
): Promise<{ callId: string }> {
  const raw = await request<RawCall>(`/api/sessions/${encodeURIComponent(sid)}/calls`, {
    method: 'POST',
    body: JSON.stringify({ phone, duration_ms: 300_000, record }),
  });
  return { callId: raw.call?.callId ?? raw.call_id ?? raw.id ?? '' };
}

/**
 * Troca de SDP (sinalização WebRTC). Recebe a offer do browser (proxiada pelo
 * Enriquece p/ injetar a API key) e devolve a answer do serviço.
 */
export async function exchangeVoiceSdp(
  sid: string,
  callId: string,
  sdpOffer: string,
): Promise<string> {
  const raw = await request<{ sdp_answer?: string }>(
    `/api/sessions/${encodeURIComponent(sid)}/calls/${encodeURIComponent(callId)}/webrtc`,
    { method: 'POST', body: JSON.stringify({ sdp_offer: sdpOffer }) },
  );
  return raw.sdp_answer ?? '';
}

/** Encerra uma chamada ativa. */
export async function endVoiceCall(sid: string, callId: string): Promise<void> {
  await request<unknown>(
    `/api/sessions/${encodeURIComponent(sid)}/calls/${encodeURIComponent(callId)}`,
    { method: 'DELETE' },
  );
}
