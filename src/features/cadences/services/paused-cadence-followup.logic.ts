/**
 * Regras puras da tarefa "Definir destino" (story paused-cadence-limbo).
 * Separado da action ('use server' só exporta funções async).
 */

/** Dias úteis sem contato antes de criar a tarefa. */
export const FOLLOWUP_MIN_BUSINESS_DAYS = 3;

/**
 * Por que o lead ficou sem próxima atividade:
 * - paused: cadência pausada sem data de volta;
 * - bounced: última inscrição terminou em bounce;
 * - replied: última inscrição terminou porque o lead respondeu.
 * bounced/replied não entram na auto-perda (só olha `completed`) — sem a tarefa,
 * ninguém é cobrado.
 */
export type FollowupKind = 'paused' | 'bounced' | 'replied';

/** Lead que respondeu não espera: a tarefa sai no mesmo dia. */
export function minBusinessDaysFor(kind: FollowupKind): number {
  return kind === 'replied' ? 0 : FOLLOWUP_MIN_BUSINESS_DAYS;
}

/** Teto de tarefas criadas por org por execução — não inundar a fila. */
export const FOLLOWUP_MAX_PER_ORG = 30;

const BRT_OFFSET_MS = 3 * 3600 * 1000; // BRT = UTC-3 fixo (sem horário de verão desde 2019)
const DAY_MS = 86400 * 1000;

/** 0h do dia BRT de `date`, em ms "UTC-midnight" (só para contar dias). */
function brtDayStart(date: Date): number {
  const shifted = date.getTime() - BRT_OFFSET_MS;
  return Math.floor(shifted / DAY_MS) * DAY_MS;
}

/**
 * Dias úteis (seg–sex) DEPOIS do dia do último contato, até hoje inclusive,
 * no calendário BRT. Último contato na quinta → sex, seg, ter = 3 na terça.
 */
export function businessDaysSince(lastContact: Date, now: Date): number {
  let count = 0;
  for (let day = brtDayStart(lastContact) + DAY_MS; day <= brtDayStart(now); day += DAY_MS) {
    const dow = new Date(day).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** 9h BRT do dia BRT de `now` (vencimento padrão das tarefas). */
export function todayAt9hBrt(now: Date): string {
  return new Date(brtDayStart(now) + BRT_OFFSET_MS + 9 * 3600 * 1000).toISOString();
}

const PAUSE_REASON_LABELS: Record<string, string> = {
  whatsapp_invalid: 'número não é WhatsApp',
  no_lead_email: 'lead sem e-mail',
  no_lead_phone: 'lead sem telefone',
  email_bounced: 'e-mail com bounce',
  domain_blacklisted: 'domínio bloqueado',
  no_sender: 'sem caixa de envio conectada',
};

/** Traduz o `reason` gravado no evento `cadence_paused` para o SDR. */
export function describePauseReason(reason: string | null | undefined): string {
  if (!reason) return 'motivo não registrado';
  if (PAUSE_REASON_LABELS[reason]) return PAUSE_REASON_LABELS[reason];
  if (reason.startsWith('permanent_email_error')) return 'erro no envio de e-mail';
  if (reason.startsWith('max_retries_email')) return 'e-mail falhou várias vezes';
  return reason;
}

export function buildFollowupNote(
  kind: FollowupKind,
  cadenceNames: string[],
  reason: string | null | undefined,
): string {
  const names = cadenceNames.length ? cadenceNames.join(', ') : 'cadência';
  if (kind === 'replied') {
    return (
      `Definir destino: lead respondeu (${names}) e está sem próxima atividade. ` +
      'Responda, troque de cadência ou marque Ganho/Perdido.'
    );
  }
  if (kind === 'bounced') {
    return (
      `Definir destino: e-mail voltou (bounce) na ${names} e o lead está sem próxima atividade. ` +
      'Corrija o e-mail, troque de cadência ou marque Ganho/Perdido.'
    );
  }
  return (
    `Definir destino: cadência pausada sem data de volta (${names} — ${describePauseReason(reason)}). ` +
    'Retome a cadência, troque de cadência ou marque Ganho/Perdido.'
  );
}
