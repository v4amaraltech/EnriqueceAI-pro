import type { ActionResult } from '@/lib/actions/action-result';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import {
  countOpenEnrollmentsBySdr,
  pickLeastLoadedSdr,
} from '@/features/leads/services/inbound-recovery.service';

import type { Uuid } from '../types';

import { isConversationOwnershipEnabled } from './ownership.service';
import { isScopedFlagEnabled, type FlagScope } from './flag-scope.service';

/**
 * Distribuicao de leads dentro do app (PR09).
 *
 * Flags em `app_flags` (escopo GLOBAL, nascem desligadas):
 *  - `lead_assignment_shadow`: calcula e registra a comparacao com a atribuicao
 *    atual. NUNCA grava em leads, cursor, enrollments ou ownership.
 *  - `lead_assignment_enforced`: unica que permite gravar, e somente pela RPC
 *    atomica `assign_lead_by_policy`. Nenhum chamador a usa neste PR.
 * Em erro de leitura as duas valem desligadas (sao flags de efeito, nao de
 * restricao). Com as duas desligadas nenhuma tabela de dados e consultada.
 *
 * Regras de decisao (nesta ordem):
 *  1. Lead com `assigned_to` mantem o dono (respeitado, nunca desfeito).
 *  2. Lead com `pending_assigned_to` em enrollment aberto mantem o pendente.
 *  3. Lead com conversa em andamento (ownership ativo do PR05) mantem o dono da conversa.
 *  4. Sem politica ativa: nada a fazer.
 *  5. Elegiveis = membros da politica marcados como elegiveis E membros ativos da org.
 *     Quem atingiu a capacidade (carga aberta >= capacidade) sai da disputa.
 *  6. Menor carga, reusando `pickLeastLoadedSdr` do recovery. Empate: anel
 *     (position, user_id) a partir do usuario seguinte ao cursor persistido,
 *     portanto estavel e independente da ordem de leitura do banco.
 *
 * Fora do escopo, por contrato: nao reatribui em massa, nao altera o rodizio
 * vigente (`inbound-recovery` e bulk-assign seguem como estao), nao le nem
 * escreve numeros, instancias ou provedores de envio.
 *
 * Logs: ids e motivos apenas (sem nome, e-mail, telefone ou corpo).
 */
export const LEAD_ASSIGNMENT_SHADOW_FLAG_KEY = 'lead_assignment_shadow';
export const LEAD_ASSIGNMENT_ENFORCED_FLAG_KEY = 'lead_assignment_enforced';

/** Teto de leads avaliados por chamada em lote (shadow nao pode pesar no bulk). */
export const MAX_SHADOW_BATCH = 100;
const MAX_ASSIGN_ATTEMPTS = 3;
const OPEN_ENROLLMENT_STATUSES = ['active', 'paused'];

type Db = ReturnType<typeof createServiceRoleClient>;
type Rows<T> = { data: T[] | null; error: { message: string } | null };

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type AssignmentAction =
  | 'keep_owner'
  | 'keep_pending'
  | 'keep_conversation_owner'
  | 'assign'
  | 'none';

export type AssignmentReason =
  | 'assigned_to_preserved'
  | 'pending_assignment_preserved'
  | 'conversation_owner_preserved'
  | 'least_loaded'
  | 'no_policy'
  | 'no_eligible_member'
  | 'capacity_exhausted';

export interface AssignmentDecision {
  action: AssignmentAction;
  /** Responsavel proposto (ou preservado). null quando nao ha candidato. */
  userId: Uuid | null;
  reason: AssignmentReason;
}

export interface AssignmentPolicy {
  id: Uuid;
  defaultCapacity: number | null;
  cursorUserId: Uuid | null;
  cursorVersion: number;
}

export interface AssignmentMember {
  userId: Uuid;
  eligible: boolean;
  capacity: number | null;
  position: number;
}

export interface AssignmentContext {
  policy: AssignmentPolicy | null;
  members: AssignmentMember[];
  activeUserIds: Set<Uuid>;
  /** Carga aberta por usuario (somente quem esta na politica). */
  loads: Record<Uuid, number>;
}

export interface LeadFacts {
  assignedTo: Uuid | null;
  pendingAssignedTo: Uuid[];
  conversationOwners: Uuid[];
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

function readEffectFlag(key: string, scope?: FlagScope): Promise<boolean> {
  return isScopedFlagEnabled(key, scope);
}

export const isLeadAssignmentShadowEnabled = (scope?: FlagScope) =>
  readEffectFlag(LEAD_ASSIGNMENT_SHADOW_FLAG_KEY, scope);
export const isLeadAssignmentEnforcedEnabled = (scope?: FlagScope) =>
  readEffectFlag(LEAD_ASSIGNMENT_ENFORCED_FLAG_KEY, scope);

// ---------------------------------------------------------------------------
// Decisao pura
// ---------------------------------------------------------------------------

function sortedUnique(ids: Uuid[]): Uuid[] {
  return [...new Set(ids)].sort();
}

/**
 * Anel de desempate: (position, user_id), girado para comecar logo depois do
 * cursor. Cursor ausente ou fora do anel comeca do inicio.
 */
export function orderRing(members: AssignmentMember[], cursorUserId: Uuid | null): Uuid[] {
  const ring = [...members]
    .sort((a, b) => a.position - b.position || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
    .map((m) => m.userId);
  const at = cursorUserId ? ring.indexOf(cursorUserId) : -1;
  if (at < 0) return ring;
  return [...ring.slice(at + 1), ...ring.slice(0, at + 1)];
}

export function pickAssignee(
  ctx: AssignmentContext,
): { userId: Uuid | null; reason: 'least_loaded' | 'no_eligible_member' | 'capacity_exhausted' } {
  const policy = ctx.policy;
  if (!policy) return { userId: null, reason: 'no_eligible_member' };
  const eligible = ctx.members.filter((m) => m.eligible && ctx.activeUserIds.has(m.userId));
  if (eligible.length === 0) return { userId: null, reason: 'no_eligible_member' };

  const withRoom = eligible.filter((m) => {
    const cap = m.capacity ?? policy.defaultCapacity;
    return cap === null || (ctx.loads[m.userId] ?? 0) < cap;
  });
  if (withRoom.length === 0) return { userId: null, reason: 'capacity_exhausted' };

  const ring = orderRing(withRoom, policy.cursorUserId);
  const picked = pickLeastLoadedSdr(ring, ctx.loads);
  return picked
    ? { userId: picked, reason: 'least_loaded' }
    : { userId: null, reason: 'no_eligible_member' };
}

/**
 * `assumeUnassigned` existe so para a comparacao em shadow: ignora o
 * `assigned_to` atual para mostrar o que a politica proporia. Nunca e usado
 * no caminho que grava.
 */
export function decideLeadAssignment(
  facts: LeadFacts,
  ctx: AssignmentContext,
  opts: { assumeUnassigned?: boolean } = {},
): AssignmentDecision {
  if (facts.assignedTo && !opts.assumeUnassigned) {
    return { action: 'keep_owner', userId: facts.assignedTo, reason: 'assigned_to_preserved' };
  }
  const pending = sortedUnique(facts.pendingAssignedTo)[0];
  if (pending) {
    return { action: 'keep_pending', userId: pending, reason: 'pending_assignment_preserved' };
  }
  const convOwner = sortedUnique(facts.conversationOwners)[0];
  if (convOwner) {
    return { action: 'keep_conversation_owner', userId: convOwner, reason: 'conversation_owner_preserved' };
  }
  if (!ctx.policy) return { action: 'none', userId: null, reason: 'no_policy' };

  const pick = pickAssignee(ctx);
  if (!pick.userId) return { action: 'none', userId: null, reason: pick.reason };
  return { action: 'assign', userId: pick.userId, reason: 'least_loaded' };
}

// ---------------------------------------------------------------------------
// Carga de dados (somente leitura, sempre filtrando por org_id)
// ---------------------------------------------------------------------------

async function loadContext(db: Db, orgId: Uuid): Promise<AssignmentContext | null> {
  const policyRes = (await from(db, 'lead_assignment_policies')
    .select('id, enabled, default_capacity, cursor_user_id, cursor_version')
    .eq('org_id', orgId)
    .limit(1)) as Rows<Record<string, unknown>>;
  if (policyRes.error) return null;
  const row = policyRes.data?.[0];
  if (!row || row.enabled !== true) {
    return { policy: null, members: [], activeUserIds: new Set(), loads: {} };
  }
  const policy: AssignmentPolicy = {
    id: String(row.id),
    defaultCapacity: typeof row.default_capacity === 'number' ? row.default_capacity : null,
    cursorUserId: typeof row.cursor_user_id === 'string' ? row.cursor_user_id : null,
    cursorVersion: typeof row.cursor_version === 'number' ? row.cursor_version : 0,
  };

  const membersRes = (await from(db, 'lead_assignment_members')
    .select('user_id, eligible, capacity, position')
    .eq('org_id', orgId)) as Rows<Record<string, unknown>>;
  if (membersRes.error) return null;
  const members: AssignmentMember[] = (membersRes.data ?? []).map((m) => ({
    userId: String(m.user_id),
    eligible: m.eligible === true,
    capacity: typeof m.capacity === 'number' ? m.capacity : null,
    position: typeof m.position === 'number' ? m.position : 0,
  }));

  const activeRes = (await from(db, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('status', 'active')) as Rows<{ user_id: string }>;
  if (activeRes.error) return null;
  const activeUserIds = new Set((activeRes.data ?? []).map((m) => m.user_id));

  const loadRes = (await from(db, 'cadence_enrollments')
    .select('pending_assigned_to, lead:leads(assigned_to)')
    .eq('org_id', orgId)
    .in('status', OPEN_ENROLLMENT_STATUSES)) as Rows<{
    pending_assigned_to: string | null;
    lead: { assigned_to: string | null } | null;
  }>;
  if (loadRes.error) return null;
  const loads = countOpenEnrollmentsBySdr(
    loadRes.data ?? [],
    members.map((m) => m.userId),
  );

  return { policy, members, activeUserIds, loads };
}

async function loadFacts(
  db: Db,
  orgId: Uuid,
  leadIds: Uuid[],
): Promise<Map<Uuid, LeadFacts> | null> {
  const leadsRes = (await from(db, 'leads')
    .select('id, assigned_to')
    .eq('org_id', orgId)
    .in('id', leadIds)) as Rows<{ id: string; assigned_to: string | null }>;
  if (leadsRes.error) return null;

  const pendingRes = (await from(db, 'cadence_enrollments')
    .select('lead_id, pending_assigned_to')
    .eq('org_id', orgId)
    .in('lead_id', leadIds)
    .in('status', OPEN_ENROLLMENT_STATUSES)) as Rows<{ lead_id: string; pending_assigned_to: string | null }>;
  if (pendingRes.error) return null;

  // Ownership so existe com a flag do PR05 ligada; desligada nao ha o que proteger.
  let owners: Array<{ lead_id: string; owner_user_id: string | null }> = [];
  if (await isConversationOwnershipEnabled({ orgId })) {
    const ownRes = (await from(db, 'conversation_ownership')
      .select('lead_id, owner_user_id')
      .eq('org_id', orgId)
      .in('lead_id', leadIds)
      .eq('status', 'active')) as Rows<{ lead_id: string; owner_user_id: string | null }>;
    if (ownRes.error) return null;
    owners = ownRes.data ?? [];
  }

  const facts = new Map<Uuid, LeadFacts>();
  for (const l of leadsRes.data ?? []) {
    facts.set(l.id, { assignedTo: l.assigned_to, pendingAssignedTo: [], conversationOwners: [] });
  }
  for (const p of pendingRes.data ?? []) {
    if (p.pending_assigned_to) facts.get(p.lead_id)?.pendingAssignedTo.push(p.pending_assigned_to);
  }
  for (const o of owners) {
    if (o.owner_user_id) facts.get(o.lead_id)?.conversationOwners.push(o.owner_user_id);
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Shadow
// ---------------------------------------------------------------------------

export type ShadowSource = 'inbound' | 'bulk_assign';

export interface ShadowEntry {
  leadId: Uuid;
  current: Uuid | null;
  decision: AssignmentDecision | null;
  diverged: boolean | null;
}

export interface ShadowRun {
  ran: boolean;
  entries: ShadowEntry[];
}

/**
 * Avalia em shadow uma lista de leads (ate MAX_SHADOW_BATCH). Le a flag uma vez;
 * desligada, nao consulta nada e devolve `ran: false`. Nunca lanca e nunca grava
 * em tabela alguma: so escreve log estruturado. Dentro do lote, simula a carga e
 * o cursor localmente (em memoria) para refletir a sequencia, sem persistir.
 */
export async function runLeadAssignmentShadowBatch(input: {
  orgId: Uuid;
  source: ShadowSource;
  leads: Array<{ leadId: Uuid; currentAssignedTo: Uuid | null }>;
}): Promise<ShadowRun> {
  const none: ShadowRun = { ran: false, entries: [] };
  try {
    if (input.leads.length === 0) return none;
    if (!(await isLeadAssignmentShadowEnabled({ orgId: input.orgId }))) return none;

    const db = createServiceRoleClient();
    const leads = input.leads.slice(0, MAX_SHADOW_BATCH);
    const [ctx, facts] = await Promise.all([
      loadContext(db, input.orgId),
      loadFacts(db, input.orgId, leads.map((l) => l.leadId)),
    ]);
    if (!ctx || !facts) return none;

    const sim: AssignmentContext = {
      ...ctx,
      policy: ctx.policy ? { ...ctx.policy } : null,
      loads: { ...ctx.loads },
    };
    const entries: ShadowEntry[] = [];
    for (const lead of leads) {
      const f = facts.get(lead.leadId);
      const decision = f ? decideLeadAssignment(f, sim, { assumeUnassigned: true }) : null;
      if (decision?.action === 'assign' && decision.userId && sim.policy) {
        sim.loads[decision.userId] = (sim.loads[decision.userId] ?? 0) + 1;
        sim.policy.cursorUserId = decision.userId;
      }
      const diverged = decision ? decision.userId !== lead.currentAssignedTo : null;
      entries.push({ leadId: lead.leadId, current: lead.currentAssignedTo, decision, diverged });
      console.warn(
        JSON.stringify({
          event: 'lead_assignment_shadow',
          source: input.source,
          orgId: input.orgId,
          leadId: lead.leadId,
          current: lead.currentAssignedTo,
          proposed: decision?.userId ?? null,
          action: decision?.action ?? 'lead_not_found',
          reason: decision?.reason ?? 'lead_not_found',
          diverged,
          cursorVersion: ctx.policy?.cursorVersion ?? null,
        }),
      );
    }
    return { ran: true, entries };
  } catch {
    return none;
  }
}

/** Atalho para um unico lead (ponto de integracao do inbound). */
export async function runLeadAssignmentShadow(input: {
  orgId: Uuid;
  leadId: Uuid;
  currentAssignedTo: Uuid | null;
  source: ShadowSource;
}): Promise<ShadowEntry | null> {
  const run = await runLeadAssignmentShadowBatch({
    orgId: input.orgId,
    source: input.source,
    leads: [{ leadId: input.leadId, currentAssignedTo: input.currentAssignedTo }],
  });
  return run.entries[0] ?? null;
}

// ---------------------------------------------------------------------------
// Enforced (atomico, sem chamador neste PR)
// ---------------------------------------------------------------------------

export type AssignLeadOutcome =
  | { assigned: true; userId: Uuid }
  | { assigned: false; reason: AssignmentReason | 'already_assigned' | 'lead_not_in_org' | 'not_eligible' };

/**
 * Atribui um lead SEM dono pela politica. Exige `lead_assignment_enforced`
 * ligada; desligada ou ilegivel, nao le dados e nao grava. A escrita e a RPC
 * `assign_lead_by_policy`, que trava a politica da org, confere o cursor
 * esperado (CAS) e so atribui se o lead ainda estiver sem dono, sem pendencia
 * e sem conversa ativa. Perdeu a corrida (`cursor_conflict`): reavalia, no
 * maximo MAX_ASSIGN_ATTEMPTS vezes. Nunca sobrescreve dono existente.
 */
export async function assignLeadByPolicy(input: {
  orgId: Uuid;
  leadId: Uuid;
}): Promise<ActionResult<AssignLeadOutcome>> {
  if (!(await isLeadAssignmentEnforcedEnabled({ orgId: input.orgId }))) {
    return { success: false, error: 'Distribuicao por politica desligada', code: 'flag_disabled' };
  }
  const db = createServiceRoleClient();

  for (let attempt = 0; attempt < MAX_ASSIGN_ATTEMPTS; attempt++) {
    const [ctx, facts] = await Promise.all([
      loadContext(db, input.orgId),
      loadFacts(db, input.orgId, [input.leadId]),
    ]);
    if (!ctx || !facts) return { success: false, error: 'Falha ao ler dados da distribuicao', code: 'read_failed' };
    const lead = facts.get(input.leadId);
    if (!lead) return { success: true, data: { assigned: false, reason: 'lead_not_in_org' } };

    const decision = decideLeadAssignment(lead, ctx);
    if (decision.action !== 'assign' || !decision.userId || !ctx.policy) {
      return { success: true, data: { assigned: false, reason: decision.reason } };
    }

    const { data, error } = (await db.rpc(
      'assign_lead_by_policy' as never,
      {
        p_org_id: input.orgId,
        p_lead_id: input.leadId,
        p_user_id: decision.userId,
        p_expected_cursor_version: ctx.policy.cursorVersion,
      } as never,
    )) as unknown as {
      data: Array<{ outcome: string }> | { outcome: string } | null;
      error: { message: string } | null;
    };
    if (error) return { success: false, error: 'Falha ao atribuir lead', code: 'rpc_failed' };
    const outcome = (Array.isArray(data) ? data[0] : data)?.outcome;

    switch (outcome) {
      case 'assigned':
        return { success: true, data: { assigned: true, userId: decision.userId } };
      case 'cursor_conflict':
        continue;
      case 'already_assigned':
      case 'lead_not_in_org':
      case 'not_eligible':
        return { success: true, data: { assigned: false, reason: outcome } };
      case 'pending_assignment':
        return { success: true, data: { assigned: false, reason: 'pending_assignment_preserved' } };
      case 'conversation_owner':
        return { success: true, data: { assigned: false, reason: 'conversation_owner_preserved' } };
      case 'no_policy':
        return { success: true, data: { assigned: false, reason: 'no_policy' } };
      default:
        return { success: false, error: 'Resposta inesperada da atribuicao', code: 'rpc_failed' };
    }
  }
  return { success: false, error: 'Conflito de cursor apos novas tentativas', code: 'cursor_conflict' };
}
