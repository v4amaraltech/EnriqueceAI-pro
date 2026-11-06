import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { isNetworkError, describeError } from './crm-network-retry';
import { pushConfirmedMeetingToCrm } from './crm-push.service';

type SupabaseClient = Parameters<typeof from>[0];

/** Teto por `.in()` — mantém a consulta longe do limite de URL do PostgREST. */
export const CRM_IN_CHUNK = 100;

/** Janela padrão (dias) da reconciliação diária de leads ganhos sem card. */
export const CRM_RECONCILE_DAYS = 14;

/** Teto de leads ganhos lidos por org em cada reconciliação. */
const CRM_RECONCILE_LIMIT_PER_ORG = 500;

/** Por que um lead ganho ficou de fora do push. */
export type CrmSkipReason = 'already_synced' | 'meeting_not_confirmed';

export interface CrmEligibilityResult<T> {
  candidates: T[];
  skipped: Array<{ id: string; reason: CrmSkipReason }>;
}

/**
 * Regra do card (story rescheduled-meeting-crm-and-feedback), compartilhada
 * pelo worker `backfill-kommo-orphans` e pela reconciliação diária:
 *  - lead que já tem interação `crm_deal_created` → `already_synced`;
 *  - lead COM closer só entra depois do feedback "Realizada"
 *    (`closer_feedback_requests.result = 'meeting_done'`) → senão
 *    `meeting_not_confirmed`;
 *  - lead SEM closer entra direto.
 *
 * Consultas em lotes de CRM_IN_CHUNK ids. A ordem dos candidatos é a de
 * entrada.
 */
export async function selectCrmEligibleWonLeads<T extends { id: string; closer_id: string | null }>(
  supabase: SupabaseClient,
  leads: T[],
): Promise<CrmEligibilityResult<T>> {
  if (leads.length === 0) return { candidates: [], skipped: [] };

  const synced = new Set<string>();
  const allIds = leads.map((l) => l.id);
  for (let i = 0; i < allIds.length; i += CRM_IN_CHUNK) {
    const chunk = allIds.slice(i, i + CRM_IN_CHUNK);
    const { data } = (await from(supabase, 'interactions')
      .select('lead_id')
      .in('lead_id', chunk)
      .eq('type', 'crm_deal_created')) as { data: Array<{ lead_id: string }> | null };
    for (const row of data ?? []) synced.add(row.lead_id);
  }

  const confirmed = new Set<string>();
  const closerLeadIds = leads.filter((l) => l.closer_id && !synced.has(l.id)).map((l) => l.id);
  for (let i = 0; i < closerLeadIds.length; i += CRM_IN_CHUNK) {
    const chunk = closerLeadIds.slice(i, i + CRM_IN_CHUNK);
    const { data } = (await from(supabase, 'closer_feedback_requests')
      .select('lead_id')
      .in('lead_id', chunk)
      .eq('result', 'meeting_done')) as { data: Array<{ lead_id: string }> | null };
    for (const row of data ?? []) confirmed.add(row.lead_id);
  }

  const candidates: T[] = [];
  const skipped: CrmEligibilityResult<T>['skipped'] = [];
  for (const lead of leads) {
    if (synced.has(lead.id)) {
      skipped.push({ id: lead.id, reason: 'already_synced' });
    } else if (lead.closer_id && !confirmed.has(lead.id)) {
      skipped.push({ id: lead.id, reason: 'meeting_not_confirmed' });
    } else {
      candidates.push(lead);
    }
  }
  return { candidates, skipped };
}

export interface CrmReconcileResult {
  /** Orgs com CRM conectado que foram varridas. */
  orgs: number;
  /** Leads elegíveis encontrados sem card. */
  candidates: number;
  /** Cards criados nesta rodada (o que de fato foi recuperado). */
  recovered: number;
  /** Push rodou mas não criou card (ex.: `no_defaults`, `lead_not_found`). */
  notCreated: number;
  /** Push lançou erro (rede esgotada, API). */
  failed: number;
  /** Lista explícita do que foi recuperado, para o log do cron. */
  recoveredLeadIds: string[];
  /** Rede fora: a varredura parou antes do fim; o resto fica para a próxima rodada. */
  abortedByNetwork: boolean;
}

export interface CrmReconcileOptions {
  /** Janela em dias (por `leads.won_at`). Padrão CRM_RECONCILE_DAYS. */
  days?: number;
  /** Restringe a uma org (testes / rodada manual). */
  orgId?: string;
  limitPerOrg?: number;
  now?: Date;
}

/**
 * Reconciliação diária: para cada org com CRM conectado, pega os leads ganhos
 * dos últimos `days` dias que ainda não têm `crm_deal_created` e que já
 * poderiam ter card (sem closer, ou closer respondeu "Realizada"), e cria o
 * card com `pushConfirmedMeetingToCrm` — mesmo funil/etapa/responsável do
 * Ganho, idempotente.
 *
 * É a rede de segurança para o caso de 27/10/2026: o push do feedback falhou
 * por DNS e nada tentava de novo. O retry em `pushLeadToCrm` cobre a falha
 * momentânea; isto aqui cobre a falha longa (host sem rede por horas).
 *
 * Se o push de um lead esgotar as tentativas por REDE, a varredura para na
 * hora (`abortedByNetwork`): não adianta gastar 40s por lead com a rede fora;
 * amanhã roda de novo. Erro de API (4xx) conta em `failed` e segue.
 */
export async function reconcileConfirmedMeetingsToCrm(
  options: CrmReconcileOptions = {},
): Promise<CrmReconcileResult> {
  const supabase = createServiceRoleClient();
  const days = options.days ?? CRM_RECONCILE_DAYS;
  const limitPerOrg = options.limitPerOrg ?? CRM_RECONCILE_LIMIT_PER_ORG;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  const result: CrmReconcileResult = {
    orgs: 0,
    candidates: 0,
    recovered: 0,
    notCreated: 0,
    failed: 0,
    recoveredLeadIds: [],
    abortedByNetwork: false,
  };

  let connQuery = from(supabase, 'crm_connections').select('org_id').eq('status', 'connected');
  if (options.orgId) connQuery = connQuery.eq('org_id', options.orgId);
  const { data: connections } = (await connQuery) as { data: Array<{ org_id: string }> | null };
  const orgIds = [...new Set((connections ?? []).map((c) => c.org_id))];
  result.orgs = orgIds.length;

  for (const orgId of orgIds) {
    const { data: wonLeads } = (await from(supabase, 'leads')
      .select('id, closer_id')
      .eq('org_id', orgId)
      .eq('status', 'won')
      .is('deleted_at', null)
      .gte('won_at', since)
      .order('won_at', { ascending: false })
      .limit(limitPerOrg)) as { data: Array<{ id: string; closer_id: string | null }> | null };

    const { candidates } = await selectCrmEligibleWonLeads(supabase, wonLeads ?? []);
    result.candidates += candidates.length;

    for (const lead of candidates) {
      try {
        const res = await pushConfirmedMeetingToCrm(orgId, lead.id);
        if (res.dealCreated) {
          result.recovered++;
          result.recoveredLeadIds.push(lead.id);
        } else {
          result.notCreated++;
          if (res.skippedReason && res.skippedReason !== 'already_synced') {
            console.warn('[crm-reconcile] card não criado lead=%s org=%s: %s', lead.id, orgId, res.skippedReason);
          }
        }
      } catch (err) {
        result.failed++;
        console.error('[crm-reconcile] push falhou lead=%s org=%s: %s', lead.id, orgId, describeError(err));
        if (isNetworkError(err)) {
          console.error('[crm-reconcile] rede indisponível — varredura interrompida; o restante fica para a próxima rodada');
          result.abortedByNetwork = true;
          return result;
        }
      }
    }
  }

  if (result.recovered > 0) {
    console.warn(
      '[crm-reconcile] %d card(s) recuperado(s) de %d candidato(s) em %d org(s): %s',
      result.recovered,
      result.candidates,
      result.orgs,
      result.recoveredLeadIds.join(','),
    );
  }
  return result;
}
