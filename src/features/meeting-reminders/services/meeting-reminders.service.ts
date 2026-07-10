import type { SupabaseClient } from '@supabase/supabase-js';

import { renderTemplate } from '@/features/cadences/utils/render-template';
import { EmailService } from '@/features/integrations/services/email.service';
import { EvolutionWhatsAppService } from '@/features/integrations/services/whatsapp-evolution.service';
import { from } from '@/lib/supabase/from';

import type { ReminderDueRow, ReminderRunSummary } from '../types';

const TIMEZONE = 'America/Sao_Paulo';
/** Espaçamento anti-ban entre disparos de WhatsApp na mesma execução (ms). */
const WHATSAPP_GAP_MS = 4000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Quiet hours: nada entre 21h e 8h (BRT). O toque fica na fila e reenvia no
 *  próximo tick dentro da janela — por isso NÃO gravamos log ao adiar. */
export function isQuietHoursBRT(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    timeZone: TIMEZONE,
  }).formatToParts(now);
  const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const hour = Number.parseInt(hourPart, 10);
  return hour < 8 || hour >= 21;
}

/** "segunda-feira, 13/07" no fuso de Brasília. */
export function formatMeetingDateBRT(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    timeZone: TIMEZONE,
  }).format(new Date(iso));
}

/** "09:15" no fuso de Brasília. */
export function formatMeetingTimeBRT(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TIMEZONE,
  }).format(new Date(iso));
}

/** Escapa valores vindos do lead (CSV/API) antes de interpolar no HTML. */
export function escapeHtmlValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Linha HTML do link do Meet, ou '' quando a reunião não tem link. Só aceita
 *  URLs https (o link é system-composed e injetado sem escape). */
export function buildLinkLine(meetLink: string | null | undefined): string {
  if (!meetLink || !/^https:\/\/[^\s"'<>]+$/i.test(meetLink)) return '';
  return `<p>🔗 <a href="${meetLink}">Entrar na reunião (Google Meet)</a></p>`;
}

function firstName(row: ReminderDueRow): string {
  const raw = row.first_name?.trim() || row.nome_fantasia?.trim() || row.razao_social?.trim() || '';
  // usa só o primeiro token para uma saudação natural
  return raw.split(/\s+/)[0] ?? '';
}

function companyName(row: ReminderDueRow): string {
  return (row.razao_social?.trim() || row.nome_fantasia?.trim() || '').trim();
}

export interface RenderedReminder {
  subject: string;
  htmlBody: string;
}

/**
 * Monta assunto + corpo do lembrete. Render em duas passadas: (1) valores do
 * lead escapados (escapeHtml=true), deixando {{link_reuniao_linha}} intacto;
 * (2) injeta a linha do link como HTML cru (não é lead-sourced e já foi
 * validada como URL https). O assunto é texto puro (o sendEmail sanitiza CRLF).
 */
export function buildReminderContent(
  row: ReminderDueRow,
  template: { subject: string | null; body: string },
  sdrName: string,
): RenderedReminder {
  const vars: Record<string, string> = {
    primeiro_nome: firstName(row),
    empresa: companyName(row),
    nome_vendedor: sdrName,
    data_reuniao: formatMeetingDateBRT(row.meeting_starts_at),
    hora_reuniao: formatMeetingTimeBRT(row.meeting_starts_at),
  };

  const subject = renderTemplate(template.subject ?? '', vars);
  let htmlBody = renderTemplate(template.body, vars, { escapeHtml: true });
  htmlBody = renderTemplate(htmlBody, { link_reuniao_linha: buildLinkLine(row.meet_link) });

  return { subject, htmlBody };
}

/** Linha do link em texto puro (WhatsApp), ou '' quando não há Meet. */
export function buildWhatsAppLinkLine(meetLink: string | null | undefined): string {
  if (!meetLink || !/^https:\/\/[^\s"'<>]+$/i.test(meetLink)) return '';
  return `🔗 Link da reunião: ${meetLink}`;
}

/**
 * Corpo do lembrete WhatsApp (texto puro). Sem escape de HTML (é texto) e link
 * injetado como URL. Duas passadas por consistência com o render de email.
 */
export function buildWhatsAppContent(
  row: ReminderDueRow,
  template: { body: string },
  sdrName: string,
): string {
  const vars: Record<string, string> = {
    primeiro_nome: firstName(row),
    empresa: companyName(row),
    nome_vendedor: sdrName,
    data_reuniao: formatMeetingDateBRT(row.meeting_starts_at),
    hora_reuniao: formatMeetingTimeBRT(row.meeting_starts_at),
  };
  let body = renderTemplate(template.body, vars);
  body = renderTemplate(body, { link_reuniao_linha: buildWhatsAppLinkLine(row.meet_link) });
  return body;
}

/** Match glob simples do phone_blacklist (padrões tipo '+5511999*' ou exatos)
 *  contra o número normalizado (55DDDXXXXXXXXX). */
export function isPhoneBlacklisted(phone: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const hasWildcard = pattern.includes('*');
    const digits = pattern.replace(/\D/g, '');
    if (!digits) return false;
    return hasWildcard ? phone.startsWith(digits) : phone === digits;
  });
}

// ---------------------------------------------------------------------------

interface RunOptions {
  /** master switch — quando false, nada é enviado (dry-run). */
  enabled: boolean;
  /** filtro de piloto: se preenchido, só processa esses SDRs. */
  pilotUserIds?: string[];
  /** filtro de piloto: se preenchido, só processa esses contextos. */
  pilotContexts?: string[];
  now?: Date;
}

/**
 * Executa uma passada do motor de lembretes de reunião. Idempotente: cada
 * (lead, passo, meeting_starts_at) reserva a chave em meeting_reminder_log
 * antes de enviar (upsert ignoreDuplicates), então duas execuções concorrentes
 * nunca disparam o mesmo lembrete.
 */
export async function runMeetingReminders(
  supabase: SupabaseClient,
  options: RunOptions,
): Promise<ReminderRunSummary> {
  const now = options.now ?? new Date();
  const summary: ReminderRunSummary = {
    enabled: options.enabled,
    due: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  // 1. Ler a view (service role → ignora RLS, vê todas as orgs).
  const { data: rowsRaw, error } = (await from(supabase, 'v_reminders_due' as never)
    .select('*')) as { data: ReminderDueRow[] | null; error: { message: string } | null };
  if (error) throw new Error(`v_reminders_due: ${error.message}`);

  let rows = rowsRaw ?? [];
  // A view só devolve linhas whatsapp quando há reminder_steps whatsapp ativos +
  // telefone/opt-in resolvido — então email e whatsapp coexistem com segurança.
  // Filtros de piloto (F5) — puro env, sem deploy.
  if (options.pilotUserIds?.length) {
    rows = rows.filter((r) => options.pilotUserIds!.includes(r.sdr_user_id));
  }
  if (options.pilotContexts?.length) {
    rows = rows.filter((r) => options.pilotContexts!.includes(r.context));
  }
  summary.due = rows.length;

  if (rows.length === 0) return summary;

  // 2. Carregar templates referenciados.
  const templateIds = [...new Set(rows.map((r) => r.message_template_id).filter(Boolean))] as string[];
  const templateMap = new Map<string, { subject: string | null; body: string }>();
  if (templateIds.length) {
    const { data: tpls } = (await from(supabase, 'message_templates')
      .select('id, subject, body')
      .in('id', templateIds)) as {
      data: Array<{ id: string; subject: string | null; body: string }> | null;
    };
    for (const t of tpls ?? []) templateMap.set(t.id, { subject: t.subject, body: t.body });
  }

  // 3. Pré-carregar gates de compliance para as orgs do lote.
  const orgIds = [...new Set(rows.map((r) => r.org_id))];
  const blacklistedDomains = new Set<string>(); // `${org}:${domain}`
  const suppressedEmails = new Set<string>(); // `${org}:${lower(email)}`
  {
    const { data: bl } = (await from(supabase, 'email_blacklist')
      .select('org_id, domain')
      .in('org_id', orgIds)) as { data: Array<{ org_id: string; domain: string }> | null };
    for (const r of bl ?? []) blacklistedDomains.add(`${r.org_id}:${r.domain.toLowerCase()}`);

    const { data: sup } = (await from(supabase, 'email_suppressions')
      .select('org_id, email')
      .in('org_id', orgIds)) as { data: Array<{ org_id: string; email: string }> | null };
    for (const r of sup ?? []) suppressedEmails.add(`${r.org_id}:${r.email.toLowerCase()}`);
  }

  // 4. SDRs com conexão Gmail ativa (para skip barato de 'sdr_sem_gmail').
  const sdrIds = [...new Set(rows.map((r) => r.sdr_user_id))];
  const gmailReady = new Set<string>(); // `${org}:${user}`
  {
    const { data: conns } = (await from(supabase, 'gmail_connections')
      .select('org_id, user_id, status')
      .in('user_id', sdrIds)
      .in('status', ['connected', 'error'])) as {
      data: Array<{ org_id: string; user_id: string }> | null;
    };
    for (const c of conns ?? []) gmailReady.add(`${c.org_id}:${c.user_id}`);
  }

  // 4b. Prontidão de WhatsApp (instância Evolution conectada: do SDR ou default
  //     da org) + phone_blacklist — só quando há linhas whatsapp no lote.
  const hasWhatsApp = rows.some((r) => r.channel === 'whatsapp');
  const waUserReady = new Set<string>(); // `${org}:${user}`
  const waOrgReady = new Set<string>(); // `${org}` (instância default org-level)
  const phoneBlacklist = new Map<string, string[]>(); // org -> patterns
  if (hasWhatsApp) {
    const { data: insts } = (await from(supabase, 'whatsapp_instances')
      .select('org_id, user_id, status')
      .in('org_id', orgIds)
      .eq('status', 'connected')) as {
      data: Array<{ org_id: string; user_id: string | null }> | null;
    };
    for (const i of insts ?? []) {
      if (i.user_id) waUserReady.add(`${i.org_id}:${i.user_id}`);
      else waOrgReady.add(i.org_id);
    }
    const { data: pb } = (await from(supabase, 'phone_blacklist')
      .select('org_id, phone_pattern')
      .in('org_id', orgIds)) as { data: Array<{ org_id: string; phone_pattern: string }> | null };
    for (const r of pb ?? []) {
      const arr = phoneBlacklist.get(r.org_id) ?? [];
      arr.push(r.phone_pattern);
      phoneBlacklist.set(r.org_id, arr);
    }
  }

  // 5. Nomes dos SDRs (via auth.users — organization_members não tem nome).
  const sdrNames = await resolveSdrNames(supabase, sdrIds);
  let whatsAppSent = 0; // p/ espaçamento anti-ban entre disparos

  // 6. Processar linha a linha.
  for (const row of rows) {
    const log = (outcome: 'sent' | 'failed' | 'skipped', reason?: string) => {
      summary[outcome === 'sent' ? 'sent' : outcome === 'failed' ? 'failed' : 'skipped'] += 1;
      summary.details.push({
        lead_id: row.lead_id,
        step: row.step_order,
        channel: row.channel,
        outcome,
        reason,
      });
    };

    // Quiet hours → adia sem gravar log (reenvia no próximo tick).
    if (isQuietHoursBRT(now)) {
      log('skipped', 'quiet_hours');
      continue;
    }

    // Sem template configurado (não deveria após F3).
    const template = row.message_template_id ? templateMap.get(row.message_template_id) : undefined;
    if (!template) {
      await recordLog(supabase, row, 'skipped', 'sem_template');
      log('skipped', 'sem_template');
      continue;
    }

    // Gates por canal.
    if (row.channel === 'email') {
      const emailLc = row.email?.toLowerCase() ?? '';
      if (!emailLc) {
        await recordLog(supabase, row, 'skipped', 'sem_email');
        log('skipped', 'sem_email');
        continue;
      }
      if (suppressedEmails.has(`${row.org_id}:${emailLc}`)) {
        await recordLog(supabase, row, 'skipped', 'email_suprimido');
        log('skipped', 'email_suprimido');
        continue;
      }
      const domain = emailLc.split('@')[1] ?? '';
      if (domain && blacklistedDomains.has(`${row.org_id}:${domain}`)) {
        await recordLog(supabase, row, 'skipped', 'dominio_blacklist');
        log('skipped', 'dominio_blacklist');
        continue;
      }
      if (!gmailReady.has(`${row.org_id}:${row.sdr_user_id}`)) {
        await recordLog(supabase, row, 'skipped', 'sdr_sem_gmail');
        log('skipped', 'sdr_sem_gmail');
        continue;
      }
    } else if (row.channel === 'whatsapp') {
      const phone = row.whatsapp_phone ?? '';
      if (!phone) {
        // a view já garante isso; guarda defensiva
        await recordLog(supabase, row, 'skipped', 'sem_whatsapp');
        log('skipped', 'sem_whatsapp');
        continue;
      }
      if (isPhoneBlacklisted(phone, phoneBlacklist.get(row.org_id) ?? [])) {
        await recordLog(supabase, row, 'skipped', 'phone_blacklist');
        log('skipped', 'phone_blacklist');
        continue;
      }
      const waReady =
        waUserReady.has(`${row.org_id}:${row.sdr_user_id}`) || waOrgReady.has(row.org_id);
      if (!waReady) {
        await recordLog(supabase, row, 'skipped', 'sem_instancia_whatsapp');
        log('skipped', 'sem_instancia_whatsapp');
        continue;
      }
    } else {
      await recordLog(supabase, row, 'skipped', 'canal_desconhecido');
      log('skipped', 'canal_desconhecido');
      continue;
    }

    // Dry-run: reporta o que SERIA enviado sem tocar no log (não-destrutivo, para
    // que ligar MEETING_REMINDERS_ENABLED depois realmente dispare este lembrete).
    if (!options.enabled) {
      log('skipped', 'dry_run');
      continue;
    }

    // Reserva idempotente (ON CONFLICT DO NOTHING). Sem linha reservada = outra
    // execução já pegou → não envia.
    const reserved = await reserveLog(supabase, row);
    if (!reserved) {
      log('skipped', 'ja_processado');
      continue;
    }

    const sdrName = sdrNames.get(row.sdr_user_id) ?? '';
    try {
      if (row.channel === 'email') {
        const { subject, htmlBody } = buildReminderContent(row, template, sdrName);
        const result = await EmailService.sendEmail(
          row.sdr_user_id,
          row.org_id,
          { to: row.email!, subject, htmlBody, leadId: row.lead_id, trackOpens: false, trackClicks: false },
          undefined,
          supabase,
        );
        if (result.success) {
          await updateLog(supabase, row, 'sent');
          log('sent');
        } else {
          await updateLog(supabase, row, 'failed', result.error ?? 'send_failed');
          log('failed', result.error ?? 'send_failed');
        }
      } else {
        // WhatsApp — espaçamento anti-ban entre disparos consecutivos.
        if (whatsAppSent > 0) await sleep(WHATSAPP_GAP_MS);
        whatsAppSent += 1;
        const body = buildWhatsAppContent(row, template, sdrName);
        const result = await EvolutionWhatsAppService.sendMessage(
          row.org_id,
          { to: row.whatsapp_phone!, body },
          supabase,
          row.sdr_user_id,
        );
        if (result.success) {
          await updateLog(supabase, row, 'sent');
          log('sent');
        } else {
          await updateLog(supabase, row, 'failed', result.error ?? 'send_failed');
          log('failed', result.error ?? 'send_failed');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'exception';
      await updateLog(supabase, row, 'failed', msg);
      log('failed', msg);
    }
  }

  return summary;
}

// --- helpers de persistência ------------------------------------------------

async function reserveLog(supabase: SupabaseClient, row: ReminderDueRow): Promise<boolean> {
  const { data } = (await from(supabase, 'meeting_reminder_log' as never)
    .upsert(
      {
        org_id: row.org_id,
        lead_id: row.lead_id,
        reminder_step_id: row.reminder_step_id,
        meeting_starts_at: row.meeting_starts_at,
        channel: row.channel,
        status: 'sending',
      } as never,
      { onConflict: 'lead_id,reminder_step_id,meeting_starts_at', ignoreDuplicates: true } as never,
    )
    .select('id')) as { data: Array<{ id: string }> | null };
  return (data?.length ?? 0) > 0;
}

async function updateLog(
  supabase: SupabaseClient,
  row: ReminderDueRow,
  status: 'sent' | 'failed' | 'skipped',
  detail?: string,
): Promise<void> {
  await from(supabase, 'meeting_reminder_log' as never)
    .update({ status, detail: detail ?? null, sent_at: new Date().toISOString() } as never)
    .eq('lead_id', row.lead_id)
    .eq('reminder_step_id', row.reminder_step_id)
    .eq('meeting_starts_at', row.meeting_starts_at);
}

/** Insere um log terminal (skip permanente) — a view exclui a chave depois. */
async function recordLog(
  supabase: SupabaseClient,
  row: ReminderDueRow,
  status: 'skipped' | 'failed',
  detail: string,
): Promise<void> {
  await from(supabase, 'meeting_reminder_log' as never).upsert(
    {
      org_id: row.org_id,
      lead_id: row.lead_id,
      reminder_step_id: row.reminder_step_id,
      meeting_starts_at: row.meeting_starts_at,
      channel: row.channel,
      status,
      detail,
    } as never,
    { onConflict: 'lead_id,reminder_step_id,meeting_starts_at', ignoreDuplicates: true } as never,
  );
}

async function resolveSdrNames(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all(
    userIds.map(async (id) => {
      try {
        const { data } = await supabase.auth.admin.getUserById(id);
        const meta = data?.user?.user_metadata as { full_name?: string; name?: string } | undefined;
        const name = meta?.full_name || meta?.name || data?.user?.email?.split('@')[0] || '';
        if (name) map.set(id, name);
      } catch {
        // sem nome — template renderiza vazio, mas o envio segue
      }
    }),
  );
  return map;
}
