import { entraNaFilaHumana } from '@/features/activities/utils/fila-humana';
import { effectiveDailyCap } from '@/features/bdr-admission/services/capacity';
import type { FlagRow } from '@/features/contact-engine/services/flag-scope.service';

export const MIXED_AUTO_EMAIL_FLAG = 'cadence_mixed_auto_email_v1';

export type MixedAutoEmailScope =
  | { kind: 'none' }
  | { kind: 'all' }
  | { kind: 'orgs'; orgIds: string[] };

export interface MixedCadenceRef {
  type?: string | null;
  executor?: string | null;
}

export interface MailboxCapInput {
  dailyCap: number | null;
  connectedAt: string | Date | null;
  pausedReason: string | null;
  now?: Date;
}

/** Lê a flag: enabled=true liga todas as orgs; senão, só allow_org_ids. Sem linha = desligado. */
export function mixedAutoEmailScopeFromFlag(row: FlagRow | null | undefined): MixedAutoEmailScope {
  if (!row) return { kind: 'none' };
  if (row.enabled === true) return { kind: 'all' };
  const orgIds = Array.isArray(row.allow_org_ids)
    ? row.allow_org_ids.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
  if (orgIds.length === 0) return { kind: 'none' };
  return { kind: 'orgs', orgIds };
}

export function orgAllowsMixedAutoEmail(scope: MixedAutoEmailScope, orgId: string | null | undefined): boolean {
  if (!orgId) return false;
  if (scope.kind === 'all') return true;
  if (scope.kind === 'none') return false;
  const needle = orgId.toLowerCase();
  return scope.orgIds.some((id) => id.toLowerCase() === needle);
}

/** Cadência humana standard: entra no discador e no WhatsApp automático. */
export function isMixedAutoEmailCadence(cadence: MixedCadenceRef): boolean {
  return cadence.type === 'standard' && entraNaFilaHumana(cadence);
}

export function startOfBrtDay(now: Date = new Date()): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [year, month, day] = fmt.format(now).split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day, 3, 0, 0, 0));
}

export function mailboxDailyCap(input: MailboxCapInput): number {
  return effectiveDailyCap({
    dailyCap: input.dailyCap,
    connectedAt: input.connectedAt,
    pausedReason: input.pausedReason,
    now: input.now ?? new Date(),
  });
}

/** true = não envia neste ciclo; a inscrição permanece vencida para tentar de novo. */
export function mailboxAtDailyCap(sentToday: number, cap: number): boolean {
  return cap <= 0 || sentToday >= cap;
}

export function pickDueMixedEmailEnrollments<
  T extends {
    current_step: number;
    cadence_id: string;
    lead: { org_id: string };
    cadence: MixedCadenceRef;
  },
>(rows: T[], emailStepOrders: Map<string, Set<number>>, scope: MixedAutoEmailScope): T[] {
  if (scope.kind === 'none') return [];
  return rows.filter((row) => {
    if (!orgAllowsMixedAutoEmail(scope, row.lead.org_id)) return false;
    if (!isMixedAutoEmailCadence(row.cadence)) return false;
    return emailStepOrders.get(row.cadence_id)?.has(row.current_step) === true;
  });
}
