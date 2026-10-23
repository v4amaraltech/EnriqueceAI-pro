/**
 * Aviso para o n8n (grupo interno) quando um lead responde um e-mail de
 * cadência do BDR IA (executor `bdr_ai`). Contrato combinado com o n8n:
 *   POST $BDR_EMAIL_REPLY_WEBHOOK_URL
 *   Content-Type: application/json · X-Enriquece-Event: email.replied
 *   corpo = BdrEmailReplyPayload (event_id = id da interaction `replied`,
 *   estável: o n8n ignora duplicata por ele).
 * Entrega: 3 tentativas com espera crescente; nunca lança — falha vai para o log.
 */

export const BDR_REPLY_WEBHOOK_EVENT = 'email.replied' as const;

export interface BdrEmailReplyPayload {
  evento: typeof BDR_REPLY_WEBHOOK_EVENT;
  event_id: string;
  org_id: string;
  lead_id: string;
  enrollment_id: string | null;
  cadence_id: string;
  cadence_nome: string | null;
  mailbox: string | null;
  thread_id: string | null;
  rfc_message_id: string | null;
  assunto: string | null;
  trecho: string | null;
  respondido_em: string;
  lead: { nome: string | null; empresa: string | null; cargo: string | null; email: string | null };
  hold_criado: boolean;
}

export interface BuildPayloadInput {
  repliedInteractionId: string;
  orgId: string;
  leadId: string;
  enrollmentId: string | null;
  cadenceId: string;
  cadenceName: string | null;
  mailboxEmail: string | null;
  threadId: string | null;
  /** Cabeçalhos da resposta (do poll); assunto cai para o do envio quando ausente. */
  reply: { rfcMessageId: string | null; subject: string | null; date: string | null } | null;
  sentSubject: string | null;
  trecho: string | null;
  lead: { first_name: string | null; last_name: string | null; nome_fantasia: string | null; razao_social: string | null; job_title: string | null; email: string | null };
  holdCriado: boolean;
  now?: Date;
}

export function buildBdrEmailReplyPayload(i: BuildPayloadInput): BdrEmailReplyPayload {
  const nome = [i.lead.first_name, i.lead.last_name].filter((v): v is string => !!v && !!v.trim()).join(' ').trim() || null;
  return {
    evento: BDR_REPLY_WEBHOOK_EVENT,
    event_id: i.repliedInteractionId,
    org_id: i.orgId,
    lead_id: i.leadId,
    enrollment_id: i.enrollmentId,
    cadence_id: i.cadenceId,
    cadence_nome: i.cadenceName,
    mailbox: i.mailboxEmail,
    thread_id: i.threadId,
    rfc_message_id: i.reply?.rfcMessageId ?? null,
    assunto: i.reply?.subject ?? i.sentSubject ?? null,
    trecho: i.trecho ? i.trecho.slice(0, 500) : null,
    respondido_em: i.reply?.date ?? (i.now ?? new Date()).toISOString(),
    lead: { nome, empresa: i.lead.nome_fantasia ?? i.lead.razao_social ?? null, cargo: i.lead.job_title ?? null, email: i.lead.email ?? null },
    hold_criado: i.holdCriado,
  };
}

export interface SendResult {
  ok: boolean;
  attempts: number;
  status?: number;
  error?: string;
}

/** Esperas entre as tentativas: imediata, +1 s, +3 s (3 tentativas, ~4 s + timeouts no pior caso). */
export const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000];
const TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Envia o aviso. Repete em erro de rede, timeout ou resposta não-2xx, com
 * espera crescente. Nunca lança: o resultado diz se entregou e quantas
 * tentativas fez, e a falha final vai para console.error.
 */
export async function sendBdrEmailReplyWebhook(
  url: string,
  payload: BdrEmailReplyPayload,
  { delaysMs = DEFAULT_RETRY_DELAYS_MS, fetchImpl = fetch, timeoutMs = TIMEOUT_MS }: { delaysMs?: number[]; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<SendResult> {
  const body = JSON.stringify(payload);
  const maxAttempts = delaysMs.length + 1;
  let last: { status?: number; error?: string } = {};

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleep(delaysMs[attempt - 2] ?? 0);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Enriquece-Event': BDR_REPLY_WEBHOOK_EVENT, 'User-Agent': 'EnriqueceAI-Webhooks/1.0' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return { ok: true, attempts: attempt, status: res.status };
      last = { status: res.status, error: `HTTP ${res.status}` };
    } catch (e) {
      last = { error: e instanceof Error ? e.message : String(e) };
    }
    console.warn(`[bdr-reply-webhook] tentativa ${attempt}/${maxAttempts} falhou (${last.error}) event_id=${payload.event_id} lead=${payload.lead_id}`);
  }

  console.error(`[bdr-reply-webhook] FALHOU após ${maxAttempts} tentativas: event_id=${payload.event_id} lead=${payload.lead_id} cadence=${payload.cadence_id} erro=${last.error}`);
  return { ok: false, attempts: maxAttempts, ...last };
}
