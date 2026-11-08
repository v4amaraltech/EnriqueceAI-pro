import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { type FlagRow, evaluateFlagRow } from './flag-scope.service';

/**
 * Painel do piloto (PR12): leitura somente. Nao envia, nao altera flag, nao grava.
 * Tudo e filtrado por `org_id` explicitamente (o cliente de service role ignora RLS).
 * Nao devolve telefone, e-mail, nome, corpo de mensagem nem ids de outras organizacoes.
 */

export const ENGINE_FLAG_KEYS = [
  'call_cockpit_v1',
  'call_cockpit_outcomes',
  'conversation_ownership_v1',
  'send_gateway_shadow',
  'send_gateway_enforced',
  'send_outbox_enqueue',
  'dispatcher_v1',
  'lead_assignment_shadow',
  'lead_assignment_enforced',
  'number_health_v1',
  'call_priority_v2',
] as const;

export type EngineFlagKey = (typeof ENGINE_FLAG_KEYS)[number];

/**
 * Ordem para PAUSAR (envio primeiro, leitura por ultimo). Ver runbook.
 * Fora desta lista de proposito: flags de seguranca (`SAFETY_FLAGS`), que ficam ligadas na pausa.
 */
export const PAUSE_ORDER: readonly EngineFlagKey[] = [
  'dispatcher_v1',
  'send_outbox_enqueue',
  'lead_assignment_enforced',
  'lead_assignment_shadow',
  'call_priority_v2',
  'call_cockpit_outcomes',
  'call_cockpit_v1',
];

/** Desligar qualquer uma destas reabriria caminho sem gateway, dono ou saude: nao fazem parte da pausa. */
export const SAFETY_FLAGS: readonly EngineFlagKey[] = [
  'send_gateway_enforced',
  'send_gateway_shadow',
  'conversation_ownership_v1',
  'number_health_v1',
];

export interface PilotFlagState {
  key: string;
  /** A linha existe em app_flags (migration aplicada). */
  present: boolean;
  /** `enabled` global. */
  globalEnabled: boolean;
  /** Esta organizacao esta em allow_org_ids. */
  orgListed: boolean;
  /** Ha restricao por usuario (allow_user_ids preenchida). Sem expor ids. */
  userRestricted: boolean;
  /** Valor efetivo para a organizacao (caminhos sem usuario). */
  effectiveForOrg: boolean;
}

export interface PilotCounts {
  windowDays: number;
  decisionEvents: Record<string, number>;
  outbox: Record<string, number>;
}

export interface PilotNumberHealth {
  instanceId: string;
  instanceName: string;
  hasOwner: boolean;
  connection: string;
  healthState: string;
  pauseReason: string | null;
  totalDailyCap: number;
  newContactsDailyCap: number;
  rampStage: number;
  evaluatedAt: string | null;
}

export interface PilotStatus {
  orgId: string;
  generatedAt: string;
  /** false: colunas de escopo ainda nao aplicadas; so o escopo global vale. */
  scopeColumnsAvailable: boolean;
  flags: PilotFlagState[];
  /** Modo do gateway para a organizacao. */
  gatewayMode: 'off' | 'shadow' | 'enforced';
  counts: PilotCounts;
  numbers: PilotNumberHealth[];
  /** Pontos que nao puderam ser lidos (nunca tratados como zero). */
  unavailable: string[];
}

export const DECISION_EVENT_TYPES = [
  'signal_observed',
  'priority_suggestion',
  'human_correction',
] as const;
export const OUTBOX_STATUSES = [
  'pending',
  'reserved',
  'sending',
  'sent',
  'failed',
  'uncertain',
  'suppressed',
  'cancelled',
] as const;

const WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

type Db = ReturnType<typeof createServiceRoleClient>;
type CountResult = { count: number | null; error?: { message: string } | null };

interface FlagDbRow extends FlagRow {
  key: string;
}

export function summarizeFlag(
  key: string,
  row: FlagDbRow | undefined,
  orgId: string,
): PilotFlagState {
  if (!row) {
    return {
      key,
      present: false,
      globalEnabled: false,
      orgListed: false,
      userRestricted: false,
      effectiveForOrg: false,
    };
  }
  const orgs = (row.allow_org_ids ?? []).map((v) => v.toLowerCase());
  return {
    key,
    present: true,
    globalEnabled: row.enabled === true,
    orgListed: orgs.includes(orgId.toLowerCase()),
    userRestricted: (row.allow_user_ids ?? []).length > 0,
    effectiveForOrg: evaluateFlagRow(row, { orgId }),
  };
}

export function deriveGatewayMode(flags: PilotFlagState[]): 'off' | 'shadow' | 'enforced' {
  const byKey = new Map(flags.map((f) => [f.key, f]));
  if (byKey.get('send_gateway_enforced')?.effectiveForOrg) return 'enforced';
  if (byKey.get('send_gateway_shadow')?.effectiveForOrg) return 'shadow';
  return 'off';
}

async function loadFlags(
  db: Db,
  orgId: string,
): Promise<{ flags: PilotFlagState[]; scoped: boolean } | null> {
  const full = (await from(db, 'app_flags')
    .select('key, enabled, allow_org_ids, allow_user_ids')
    .in('key', [...ENGINE_FLAG_KEYS])) as {
    data: FlagDbRow[] | null;
    error?: { message: string } | null;
  };
  let rows = full.data;
  let scoped = true;
  if (full.error || !rows) {
    const plain = (await from(db, 'app_flags')
      .select('key, enabled')
      .in('key', [...ENGINE_FLAG_KEYS])) as {
      data: FlagDbRow[] | null;
      error?: { message: string } | null;
    };
    if (plain.error || !plain.data) return null;
    rows = plain.data;
    scoped = false;
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return { flags: ENGINE_FLAG_KEYS.map((k) => summarizeFlag(k, byKey.get(k), orgId)), scoped };
}

async function countWhere(
  db: Db,
  table: string,
  orgId: string,
  column: string,
  value: string,
  sinceIso?: string,
): Promise<number | null> {
  try {
    let q = from(db, table)
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq(column, value);
    if (sinceIso) q = q.gte('created_at', sinceIso);
    const res = (await q) as CountResult;
    if (res.error || res.count === null || res.count === undefined) return null;
    return res.count;
  } catch {
    return null;
  }
}

export async function loadPilotStatus(orgId: string, now: Date = new Date()): Promise<PilotStatus> {
  const db = createServiceRoleClient();
  const unavailable: string[] = [];
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString();

  let flagsResult: Awaited<ReturnType<typeof loadFlags>> = null;
  try {
    flagsResult = await loadFlags(db, orgId);
  } catch {
    flagsResult = null;
  }
  if (!flagsResult) unavailable.push('flags');
  const flags = flagsResult?.flags ?? [];

  const [eventCounts, outboxCounts, instances] = await Promise.all([
    Promise.all(
      DECISION_EVENT_TYPES.map((t) =>
        countWhere(db, 'decision_events', orgId, 'event_type', t, since),
      ),
    ),
    Promise.all(OUTBOX_STATUSES.map((s) => countWhere(db, 'send_outbox', orgId, 'status', s))),
    (async () => {
      try {
        return (await from(db, 'whatsapp_instances')
          .select(
            'id, instance_name, user_id, status, health_state, health_pause_reason, health_total_daily_cap, health_new_contacts_daily_cap, health_ramp_stage, health_evaluated_at',
          )
          .eq('org_id', orgId)
          .order('created_at', { ascending: true })
          .limit(50)) as {
          data: Array<{
            id: string;
            instance_name: string;
            user_id: string | null;
            status: string;
            health_state: string;
            health_pause_reason: string | null;
            health_total_daily_cap: number;
            health_new_contacts_daily_cap: number;
            health_ramp_stage: number;
            health_evaluated_at: string | null;
          }> | null;
          error?: { message: string } | null;
        };
      } catch {
        return { data: null, error: { message: 'read_failed' } };
      }
    })(),
  ]);

  const decisionEvents: Record<string, number> = {};
  DECISION_EVENT_TYPES.forEach((t, i) => {
    const v = eventCounts[i];
    if (v === null || v === undefined) unavailable.push(`decision_events:${t}`);
    else decisionEvents[t] = v;
  });
  const outbox: Record<string, number> = {};
  OUTBOX_STATUSES.forEach((s, i) => {
    const v = outboxCounts[i];
    if (v === null || v === undefined) unavailable.push(`send_outbox:${s}`);
    else outbox[s] = v;
  });

  let numbers: PilotNumberHealth[] = [];
  if (instances.error || !instances.data) {
    unavailable.push('whatsapp_instances');
  } else {
    numbers = instances.data.map((r) => ({
      instanceId: r.id,
      instanceName: r.instance_name,
      hasOwner: r.user_id !== null,
      connection: r.status,
      healthState: r.health_state,
      pauseReason: r.health_pause_reason,
      totalDailyCap: r.health_total_daily_cap,
      newContactsDailyCap: r.health_new_contacts_daily_cap,
      rampStage: r.health_ramp_stage,
      evaluatedAt: r.health_evaluated_at,
    }));
  }

  return {
    orgId,
    generatedAt: now.toISOString(),
    scopeColumnsAvailable: flagsResult?.scoped ?? false,
    flags,
    gatewayMode: deriveGatewayMode(flags),
    counts: { windowDays: WINDOW_DAYS, decisionEvents, outbox },
    numbers,
    unavailable,
  };
}
