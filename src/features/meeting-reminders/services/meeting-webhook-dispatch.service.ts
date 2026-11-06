import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { resolveUserProfiles } from '@/lib/auth/user-directory';

const TIMEZONE = 'America/Sao_Paulo';
/** Só dispara a partir das 8h BRT (a manhã do dia D-1 / do dia da reunião). */
const FIRE_HOUR_BRT = 8;
/** Timeout do POST pro n8n. */
const WEBHOOK_TIMEOUT_MS = 10_000;

export type MeetingWebhookMomento = 'd1' | 'dia';

/** Linha da view v_meeting_webhook_candidates. */
export interface MeetingWebhookCandidate {
  org_id: string;
  lead_id: string;
  first_name: string | null;
  last_name: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  meeting_starts_at: string;
  meeting_scheduled_at: string | null;
  meet_link: string | null;
  calendar_event_id: string | null;
  whatsapp_phone: string | null;
  /** E-mail do closer responsável (closers.email = calendar_id da agenda dele). */
  responsavel_email: string | null;
  /** Nome do closer responsável (closers.name), dono do responsavel_email. */
  responsavel: string | null;
  /**
   * user_id do SDR que MARCOU a reunião (performed_by da interação
   * meeting_scheduled). null em lead inbound que agendou sozinho — o nome é
   * resolvido no runner via auth.users.
   */
  sdr_user_id: string | null;
}

/** Corpo enviado ao webhook do n8n. */
export interface MeetingWebhookPayload {
  lead_id: string;
  nome: string;
  telefone: string | null;
  inicio: string;
  link: string | null;
  event_id: string | null;
  /** E-mail do closer = calendar_id da agenda que o n8n lê/move. */
  responsavel_email: string | null;
  /**
   * Nome do SDR que MARCOU a reunião. null quando não há SDR (ex.: lead inbound
   * que agendou sozinho) — a chave é sempre enviada, nunca omitida.
   */
  sdr: string | null;
  /** Nome do closer que vai CONDUZIR a reunião (dono do responsavel_email). */
  responsavel: string | null;
  momento: MeetingWebhookMomento;
}

export interface MeetingWebhookRunOptions {
  /** master switch — quando false, é dry-run (não faz POST nem grava log). */
  enabled: boolean;
  /** org alvo (só V4 Amaral por ora). */
  orgId: string;
  /** URL do webhook n8n. */
  webhookUrl: string;
  /** segredo opcional → vai no header x-webhook-secret quando presente. */
  webhookSecret?: string;
  /** momentos ativos (default d1 + dia). */
  momentos: MeetingWebhookMomento[];
  now?: Date;
}

export interface MeetingWebhookRunSummary {
  enabled: boolean;
  candidates: number;
  sent: number;
  failed: number;
  skipped: number;
  details: Array<{
    lead_id: string;
    momento: MeetingWebhookMomento;
    outcome: 'sent' | 'failed' | 'skipped';
    reason?: string;
  }>;
}

// --- helpers puros (testáveis) ---------------------------------------------

/** Data no fuso de Brasília no formato YYYY-MM-DD. */
export function brtDateStr(date: Date): string {
  // en-CA formata como ISO (YYYY-MM-DD).
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: TIMEZONE,
  }).format(date);
}

/** Hora (0-23) no fuso de Brasília. */
export function brtHour(date: Date): number {
  const part = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    timeZone: TIMEZONE,
  }).format(date);
  return Number.parseInt(part, 10);
}

/**
 * Quais momentos estão "vencidos" AGORA para uma reunião. Regras:
 * - só a partir das 8h BRT (a manhã);
 * - 'dia' quando a reunião é hoje (BRT);
 * - 'd1' quando a reunião é amanhã (BRT).
 * Retorna só os momentos que também estão em `active`.
 */
export function computeDueMomentos(
  meetingStartsAtIso: string,
  now: Date,
  active: MeetingWebhookMomento[],
): MeetingWebhookMomento[] {
  if (brtHour(now) < FIRE_HOUR_BRT) return [];

  const meetingDay = brtDateStr(new Date(meetingStartsAtIso));
  const todayStr = brtDateStr(now);
  const tomorrowStr = brtDateStr(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  const due: MeetingWebhookMomento[] = [];
  if (meetingDay === todayStr) due.push('dia');
  else if (meetingDay === tomorrowStr) due.push('d1');

  return due.filter((m) => active.includes(m));
}

/** Nome completo do contato (fallback razão/fantasia). */
export function buildNome(c: MeetingWebhookCandidate): string {
  const person = [c.first_name, c.last_name]
    .map((s) => s?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
    .trim();
  return person || c.razao_social?.trim() || c.nome_fantasia?.trim() || '';
}

/** normalize_br_phone devolve 55DDD…; o n8n espera nacional (sem 55). */
export function toNationalPhone(normalized: string | null): string | null {
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, '');
  return digits.startsWith('55') ? digits.slice(2) : digits;
}

export function buildWebhookPayload(
  c: MeetingWebhookCandidate,
  momento: MeetingWebhookMomento,
  sdrName: string | null,
): MeetingWebhookPayload {
  return {
    lead_id: c.lead_id,
    nome: buildNome(c),
    telefone: toNationalPhone(c.whatsapp_phone),
    inicio: new Date(c.meeting_starts_at).toISOString(),
    link: c.meet_link ?? null,
    event_id: c.calendar_event_id ?? null,
    responsavel_email: c.responsavel_email ?? null,
    sdr: sdrName,
    responsavel: c.responsavel ?? null,
    momento,
  };
}

/**
 * Resolve user_id → nome de exibição via auth.users (full_name > name > prefixo
 * do e-mail). Só pra preencher o campo `sdr` do payload. Best-effort: um id que
 * não resolve fica fora do mapa e o payload manda `sdr: null` (não inventa
 * valor). Espelha o padrão de meeting-reminders.service.ts.
 */
async function resolveSdrNames(ids: string[]): Promise<Map<string, string>> {
  // Best-effort — id não resolvido cai em sdr=null.
  const map = new Map<string, string>();
  for (const [id, p] of await resolveUserProfiles(ids)) {
    const name = p.fullName || p.email?.split('@')[0] || '';
    if (name) map.set(id, name);
  }
  return map;
}

/** Chave de idempotência (lead|início-UTC|momento). */
function dispatchKey(leadId: string, meetingStartsAtIso: string, momento: string): string {
  return `${leadId}|${new Date(meetingStartsAtIso).toISOString()}|${momento}`;
}

// --- POST -------------------------------------------------------------------

async function postWebhook(
  url: string,
  secret: string | undefined,
  payload: MeetingWebhookPayload,
): Promise<{ ok: boolean; detail?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers['x-webhook-secret'] = secret;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    return { ok: false, detail: `http_${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'fetch_error' };
  } finally {
    clearTimeout(timer);
  }
}

// --- runner -----------------------------------------------------------------

/**
 * Uma passada do dispatcher de webhook de reunião. Idempotente: só grava
 * meeting_webhook_dispatch_log em caso de sucesso, então uma falha transitória
 * é re-tentada no próximo tick (o log 'sent' é o que bloqueia re-disparo).
 */
export async function runMeetingWebhookDispatch(
  supabase: SupabaseClient,
  options: MeetingWebhookRunOptions,
): Promise<MeetingWebhookRunSummary> {
  const now = options.now ?? new Date();
  const summary: MeetingWebhookRunSummary = {
    enabled: options.enabled,
    candidates: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  // 1. Candidatos do org (reuniões válidas e futuras).
  const { data: rowsRaw, error } = (await from(supabase, 'v_meeting_webhook_candidates' as never)
    .select('*')
    .eq('org_id', options.orgId)) as {
    data: MeetingWebhookCandidate[] | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(`v_meeting_webhook_candidates: ${error.message}`);

  const rows = rowsRaw ?? [];
  summary.candidates = rows.length;
  if (rows.length === 0) return summary;

  // 1b. Nome do SDR que marcou (resolvido de auth.users — não fica na view).
  const sdrNames = await resolveSdrNames(
    rows.map((r) => r.sdr_user_id).filter((id): id is string => Boolean(id)),
  );

  // 2. Chaves já disparadas com sucesso (idempotência).
  const { data: sentRaw } = (await from(supabase, 'meeting_webhook_dispatch_log' as never)
    .select('lead_id, meeting_starts_at, momento')
    .eq('org_id', options.orgId)
    .eq('status', 'sent')) as {
    data: Array<{ lead_id: string; meeting_starts_at: string; momento: string }> | null;
  };
  const sentSet = new Set(
    (sentRaw ?? []).map((r) => dispatchKey(r.lead_id, r.meeting_starts_at, r.momento)),
  );

  // 3. Processar.
  for (const row of rows) {
    const due = computeDueMomentos(row.meeting_starts_at, now, options.momentos);
    for (const momento of due) {
      const log = (outcome: 'sent' | 'failed' | 'skipped', reason?: string) => {
        summary[outcome] += 1;
        summary.details.push({ lead_id: row.lead_id, momento, outcome, reason });
      };

      if (sentSet.has(dispatchKey(row.lead_id, row.meeting_starts_at, momento))) {
        log('skipped', 'ja_disparado');
        continue;
      }

      const payload = buildWebhookPayload(
        row,
        momento,
        row.sdr_user_id ? (sdrNames.get(row.sdr_user_id) ?? null) : null,
      );

      // Dry-run: reporta o que SERIA enviado sem tocar em nada.
      if (!options.enabled) {
        log('skipped', 'dry_run');
        continue;
      }

      const result = await postWebhook(options.webhookUrl, options.webhookSecret, payload);
      if (result.ok) {
        // Grava só no sucesso (chave única = backstop contra corrida).
        await from(supabase, 'meeting_webhook_dispatch_log' as never).upsert(
          {
            org_id: row.org_id,
            lead_id: row.lead_id,
            meeting_starts_at: row.meeting_starts_at,
            momento,
            status: 'sent',
            payload,
          } as never,
          { onConflict: 'lead_id,meeting_starts_at,momento', ignoreDuplicates: true } as never,
        );
        sentSet.add(dispatchKey(row.lead_id, row.meeting_starts_at, momento));
        log('sent');
      } else {
        // Sem gravar log → re-tenta no próximo tick.
        console.warn(
          `[meeting-webhook] lead=${row.lead_id} momento=${momento} falhou: ${result.detail}`,
        );
        log('failed', result.detail);
      }
    }
  }

  return summary;
}
