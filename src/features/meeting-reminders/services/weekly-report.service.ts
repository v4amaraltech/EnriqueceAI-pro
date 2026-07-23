/**
 * Relatório semanal de comparecimento de reuniões vs exposição aos lembretes
 * (meeting-reminders). Roda no cron `meeting-reminders-weekly-report` e envia,
 * para cada org com a automação ativa, um email aos managers com a taxa de
 * comparecimento quebrada por exposição ao lembrete (com/sem), por SDR e por
 * origem — sempre com o `n` ao lado e alerta quando a amostra é pequena.
 *
 * Fonte da verdade (definições canônicas — não reinventar):
 *  - reunião vive em `leads`; comparecimento = `meeting_held_at IS NOT NULL`.
 *  - reunião passada = `meeting_starts_at < now() AND deleted_at IS NULL`.
 *  - exposição ao lembrete = lead com linha `status='sent'` em `meeting_reminder_log`.
 *  - origem: lead_source Blackbox/Leadbroker = inbound; Outbound = outbound.
 *
 * O envio usa `sendPlatformEmail` (Resend, noreply@enriqueceai.com.br) — NÃO
 * depende do Gmail de nenhum SDR. Não escreve em `leads`/`interactions` (só lê).
 */
import type { ActionResult } from '@/lib/actions/action-result';
import { resolveUserEmails } from '@/lib/auth/user-directory';
import { sendPlatformEmail } from '@/lib/email/platform-email';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

type SupabaseClient = ReturnType<typeof createServiceRoleClient>;

const JOB_NAME = 'meeting-reminders-weekly-report';
/** Início da medição: go-live do piloto de email (10/07/2026, 00:00 BRT = 03:00 UTC). */
const CUMULATIVE_SINCE_ISO = '2026-07-10T03:00:00.000Z';
/** Abaixo disto, a taxa está dominada por ruído estatístico — avisar, não concluir. */
const SMALL_SAMPLE_THRESHOLD = 30;

// --- Tipos de domínio ---------------------------------------------------------

interface MeetingRow {
  lead_id: string;
  assigned_to: string | null;
  lead_source: string | null;
  meeting_starts_at: string;
  held: boolean;
}

interface SendRow {
  status: string;
  detail: string | null;
}

interface RateCell {
  total: number;
  held: number;
}

interface CohortRates {
  com: RateCell; // com lembrete
  sem: RateCell; // sem lembrete
  all: RateCell; // total (com + sem)
}

interface DimensionRow {
  label: string;
  rates: CohortRates;
}

export interface WeeklyReportData {
  orgName: string;
  generatedAtBrt: string;
  weekLabel: string;
  weekOverall: CohortRates;
  cumulativeOverall: CohortRates;
  bySdr: DimensionRow[];
  byContext: DimensionRow[];
  sends: { sent: number; skipped: number; failed: number; issues: Array<{ label: string; n: number }> };
}

interface OrgReportSummary {
  orgId: string;
  managers: number;
  emailsSent: number;
  emailsFailed: number;
  weekMeetings: number;
}

// --- Cálculo (puro, testável) -------------------------------------------------

function emptyCohorts(): CohortRates {
  return { com: { total: 0, held: 0 }, sem: { total: 0, held: 0 }, all: { total: 0, held: 0 } };
}

function accumulate(cohorts: CohortRates, exposed: boolean, held: boolean): void {
  const bucket = exposed ? cohorts.com : cohorts.sem;
  bucket.total += 1;
  cohorts.all.total += 1;
  if (held) {
    bucket.held += 1;
    cohorts.all.held += 1;
  }
}

export function contextOf(leadSource: string | null): 'inbound' | 'outbound' | 'outro' {
  if (leadSource === 'Blackbox' || leadSource === 'Leadbroker') return 'inbound';
  if (leadSource === 'Outbound') return 'outbound';
  return 'outro';
}

/** Monta o relatório a partir das linhas já carregadas. Função pura. */
export function computeReport(input: {
  orgName: string;
  meetings: MeetingRow[];
  sentLeadIds: Set<string>;
  sends: SendRow[];
  sdrNames: Map<string, string>;
  weekStart: Date;
  now: Date;
}): WeeklyReportData {
  const { orgName, meetings, sentLeadIds, sends, sdrNames, weekStart, now } = input;

  const weekOverall = emptyCohorts();
  const cumulativeOverall = emptyCohorts();
  const bySdr = new Map<string, CohortRates>();
  const byContext = new Map<string, CohortRates>();

  for (const m of meetings) {
    const exposed = sentLeadIds.has(m.lead_id);
    const startedAt = new Date(m.meeting_starts_at);

    // Acumulado (todas as reuniões passadas desde o go-live)
    accumulate(cumulativeOverall, exposed, m.held);

    const sdrKey = m.assigned_to ?? '(sem responsável)';
    if (!bySdr.has(sdrKey)) bySdr.set(sdrKey, emptyCohorts());
    accumulate(bySdr.get(sdrKey)!, exposed, m.held);

    const ctx = contextOf(m.lead_source);
    if (!byContext.has(ctx)) byContext.set(ctx, emptyCohorts());
    accumulate(byContext.get(ctx)!, exposed, m.held);

    // Semana (subconjunto)
    if (startedAt >= weekStart && startedAt < now) {
      accumulate(weekOverall, exposed, m.held);
    }
  }

  const sdrRows: DimensionRow[] = [...bySdr.entries()]
    .map(([key, rates]) => ({ label: sdrNames.get(key) ?? key, rates }))
    .sort((a, b) => b.rates.all.total - a.rates.all.total);

  const contextOrder = ['inbound', 'outbound', 'outro'];
  const contextRows: DimensionRow[] = [...byContext.entries()]
    .map(([key, rates]) => ({ label: key, rates }))
    .sort((a, b) => contextOrder.indexOf(a.label) - contextOrder.indexOf(b.label));

  // Envios da semana por status
  const sendCounts = { sent: 0, skipped: 0, failed: 0 };
  const issueMap = new Map<string, number>();
  for (const s of sends) {
    if (s.status === 'sent') sendCounts.sent += 1;
    else if (s.status === 'skipped') sendCounts.skipped += 1;
    else if (s.status === 'failed') sendCounts.failed += 1;
    if (s.status === 'skipped' || s.status === 'failed') {
      const label = `${s.status}: ${s.detail ?? 'sem detalhe'}`;
      issueMap.set(label, (issueMap.get(label) ?? 0) + 1);
    }
  }
  const issues = [...issueMap.entries()]
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n);

  return {
    orgName,
    generatedAtBrt: formatBrtDateTime(now),
    weekLabel: `${formatBrtDate(weekStart)} a ${formatBrtDate(new Date(now.getTime() - 24 * 60 * 60 * 1000))}`,
    weekOverall,
    cumulativeOverall,
    bySdr: sdrRows,
    byContext: contextRows,
    sends: { ...sendCounts, issues },
  };
}

// --- Formatação ---------------------------------------------------------------

function formatBrtDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
}

function formatBrtDateTime(d: Date): string {
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function pctLabel(cell: RateCell): string {
  if (cell.total === 0) return '—';
  return `${((100 * cell.held) / cell.total).toFixed(1).replace('.', ',')}%`;
}

function sampleNote(total: number): string {
  return total < SMALL_SAMPLE_THRESHOLD
    ? ` <span style="color:#b45309;font-weight:600;">⚠ n&lt;${SMALL_SAMPLE_THRESHOLD}</span>`
    : '';
}

// --- Render HTML (puro) -------------------------------------------------------

function cohortCells(rates: CohortRates): string {
  return `
    <td style="padding:8px 10px;text-align:center;color:#1a1a1a;font-size:14px;">${pctLabel(rates.com)}<br><span style="color:#9ca3af;font-size:12px;">${rates.com.held}/${rates.com.total}${sampleNote(rates.com.total)}</span></td>
    <td style="padding:8px 10px;text-align:center;color:#1a1a1a;font-size:14px;">${pctLabel(rates.sem)}<br><span style="color:#9ca3af;font-size:12px;">${rates.sem.held}/${rates.sem.total}${sampleNote(rates.sem.total)}</span></td>
    <td style="padding:8px 10px;text-align:center;color:#6b7280;font-size:14px;">${pctLabel(rates.all)}<br><span style="color:#9ca3af;font-size:12px;">${rates.all.held}/${rates.all.total}</span></td>`;
}

function dimensionTable(title: string, rows: DimensionRow[]): string {
  const body = rows.length
    ? rows
        .map(
          (r) => `<tr style="border-top:1px solid #e5e7eb;">
        <td style="padding:8px 10px;color:#1a1a1a;font-size:14px;text-transform:capitalize;">${escapeHtml(r.label)}</td>
        ${cohortCells(r.rates)}
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="4" style="padding:12px;color:#9ca3af;font-size:14px;text-align:center;">Sem reuniões no período.</td></tr>`;

  return `
    <p style="color:#1a1a1a;font-size:16px;font-weight:600;margin:24px 0 8px;">${title}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;">
      <tr style="background:#eef0f2;">
        <td style="padding:8px 10px;color:#6b7280;font-size:12px;font-weight:600;"> </td>
        <td style="padding:8px 10px;text-align:center;color:#6b7280;font-size:12px;font-weight:600;">COM lembrete</td>
        <td style="padding:8px 10px;text-align:center;color:#6b7280;font-size:12px;font-weight:600;">SEM lembrete</td>
        <td style="padding:8px 10px;text-align:center;color:#6b7280;font-size:12px;font-weight:600;">Total</td>
      </tr>
      ${body}
    </table>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderReportHtml(data: WeeklyReportData): string {
  const issuesBlock = data.sends.issues.length
    ? `<p style="color:#4a4a4a;font-size:14px;margin:8px 0 0;">Ocorrências: ${data.sends.issues
        .map((i) => `${escapeHtml(i.label)} (${i.n})`)
        .join(' · ')}</p>`
    : '';

  const healthColor = data.sends.failed > 0 ? '#dc2626' : '#22c55e';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); max-width: 640px;">
          <tr>
            <td style="background: #1a1a1a; padding: 24px 32px;">
              <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 600;">Comparecimento de reuniões — lembretes</h1>
              <p style="color: #9ca3af; font-size: 14px; margin: 6px 0 0;">${escapeHtml(data.orgName)} · semana ${escapeHtml(data.weekLabel)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px;">
              <p style="color:#4a4a4a;line-height:1.6;margin:0 0 4px;font-size:15px;">
                Taxa de comparecimento (reuniões realizadas ÷ reuniões passadas), comparando quem <strong>recebeu</strong> lembrete vs quem <strong>não recebeu</strong>. O <code>n</code> aparece embaixo de cada taxa.
              </p>
              <p style="color:#b45309;line-height:1.5;margin:8px 0 0;font-size:13px;">
                ⚠ Amostras com n&lt;${SMALL_SAMPLE_THRESHOLD} estão dentro do ruído estatístico — não conclua efeito ainda.
              </p>

              ${dimensionTable(`Semana (${escapeHtml(data.weekLabel)})`, [{ label: 'Geral', rates: data.weekOverall }])}
              ${dimensionTable('Acumulado (desde 10/jul)', [{ label: 'Geral', rates: data.cumulativeOverall }])}
              ${dimensionTable('Por SDR (acumulado)', data.bySdr)}
              ${dimensionTable('Por origem (acumulado)', data.byContext)}

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;background:#f9fafb;border-radius:8px;border-left:4px solid ${healthColor};">
                <tr><td style="padding:16px 20px;">
                  <strong style="color:#1a1a1a;font-size:15px;">Saúde do envio (semana)</strong>
                  <p style="color:#4a4a4a;font-size:14px;margin:6px 0 0;">
                    ${data.sends.sent} enviados · ${data.sends.skipped} pulados · ${data.sends.failed} falhas
                  </p>
                  ${issuesBlock}
                </td></tr>
              </table>

              <p style="color:#9ca3af;font-size:12px;margin:24px 0 0;line-height:1.5;">
                Gerado automaticamente em ${escapeHtml(data.generatedAtBrt)} (BRT) pelo EnriqueceAI. Comparecimento = reunião com desfecho "realizada". A leitura ganha significância à medida que o volume acumula.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

// --- Orquestração (I/O) -------------------------------------------------------

async function loadOrgReport(
  supabase: SupabaseClient,
  orgId: string,
  orgName: string,
  weekStart: Date,
  now: Date,
): Promise<WeeklyReportData> {
  // Reuniões passadas desde o go-live
  const { data: meetingsRaw } = (await from(supabase, 'leads')
    .select('id, assigned_to, lead_source, meeting_starts_at, meeting_held_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('meeting_starts_at', CUMULATIVE_SINCE_ISO)
    .lt('meeting_starts_at', now.toISOString())) as {
    data: Array<{
      id: string;
      assigned_to: string | null;
      lead_source: string | null;
      meeting_starts_at: string | null;
      meeting_held_at: string | null;
    }> | null;
  };

  const meetings: MeetingRow[] = (meetingsRaw ?? [])
    .filter((m) => m.meeting_starts_at)
    .map((m) => ({
      lead_id: m.id,
      assigned_to: m.assigned_to,
      lead_source: m.lead_source,
      meeting_starts_at: m.meeting_starts_at as string,
      held: m.meeting_held_at !== null,
    }));

  // Leads expostos ao lembrete (status='sent') na org
  const { data: sentRaw } = (await from(supabase, 'meeting_reminder_log')
    .select('lead_id')
    .eq('org_id', orgId)
    .eq('status', 'sent')) as { data: Array<{ lead_id: string }> | null };
  const sentLeadIds = new Set((sentRaw ?? []).map((r) => r.lead_id));

  // Envios da semana por status (saúde do worker)
  const { data: sendsRaw } = (await from(supabase, 'meeting_reminder_log')
    .select('status, detail, sent_at')
    .eq('org_id', orgId)
    .gte('sent_at', weekStart.toISOString())) as {
    data: Array<{ status: string; detail: string | null; sent_at: string | null }> | null;
  };
  const sends: SendRow[] = (sendsRaw ?? []).map((s) => ({ status: s.status, detail: s.detail }));

  // Nomes dos SDRs
  const sdrIds = [...new Set(meetings.map((m) => m.assigned_to).filter((v): v is string => v !== null))];
  const sdrNames = await resolveSdrNames(supabase, sdrIds);

  return computeReport({ orgName, meetings, sentLeadIds, sends, sdrNames, weekStart, now });
}

async function resolveSdrNames(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const id of userIds) {
    try {
      const { data } = await supabase.auth.admin.getUserById(id);
      const meta = data.user?.user_metadata as Record<string, unknown> | undefined;
      const name = (meta?.full_name ?? meta?.name) as string | undefined;
      if (name) names.set(id, name);
      else if (data.user?.email) names.set(id, data.user.email);
    } catch {
      // best-effort — cai no fallback (o próprio user_id) no render
    }
  }
  return names;
}

async function resolveManagerEmails(supabase: SupabaseClient, orgId: string): Promise<string[]> {
  const { data: members } = (await from(supabase, 'organization_members')
    .select('user_id, role')
    .eq('org_id', orgId)
    .eq('status', 'active')) as { data: Array<{ user_id: string; role: 'manager' | 'sdr' }> | null };

  const managerIds = (members ?? []).filter((m) => m.role === 'manager').map((m) => m.user_id);
  if (!managerIds.length) return [];

  const emailMap = await resolveUserEmails(managerIds);
  return managerIds.map((id) => emailMap.get(id)).filter((e): e is string => Boolean(e));
}

/**
 * Entry-point do worker. Para cada org com a automação de lembretes ativa,
 * calcula o relatório e envia aos managers. Idempotência não é crítica (relatório
 * informativo); reexecução manual reenvia — por isso o cron é semanal e único.
 */
export async function runWeeklyReport(): Promise<ActionResult<{ orgs: OrgReportSummary[] }>> {
  const supabase = createServiceRoleClient();
  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Orgs que têm a automação configurada (têm contexto de origem semeado)
  const { data: orgsRaw } = (await from(supabase, 'reminder_source_context')
    .select('org_id')) as { data: Array<{ org_id: string }> | null };
  const orgIds = [...new Set((orgsRaw ?? []).map((r) => r.org_id))];

  const summaries: OrgReportSummary[] = [];

  for (const orgId of orgIds) {
    const { data: org } = (await from(supabase, 'organizations')
      .select('name')
      .eq('id', orgId)
      .maybeSingle()) as { data: { name: string | null } | null };
    const orgName = org?.name ?? 'Organização';

    const report = await loadOrgReport(supabase, orgId, orgName, weekStart, now);
    const recipients = await resolveManagerEmails(supabase, orgId);
    const html = renderReportHtml(report);
    const subject = `Comparecimento de reuniões — ${orgName} (semana ${report.weekLabel})`;

    let emailsSent = 0;
    let emailsFailed = 0;
    for (const to of recipients) {
      const result = await sendPlatformEmail({ to, subject, html });
      if (result.success) emailsSent += 1;
      else {
        emailsFailed += 1;
        console.error('[weekly-report] Falha ao enviar para', to, result.error);
      }
    }

    summaries.push({
      orgId,
      managers: recipients.length,
      emailsSent,
      emailsFailed,
      weekMeetings: report.weekOverall.all.total,
    });
  }

  await from(supabase, 'worker_run_state')
    .upsert(
      {
        job_name: JOB_NAME,
        last_run_at: now.toISOString(),
        last_status: 'success',
        last_success_at: now.toISOString(),
        metadata: { orgs: summaries },
      } as Record<string, unknown>,
      { onConflict: 'job_name' },
    );

  return { success: true, data: { orgs: summaries } };
}
