import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { ingestInboundLeads } from '@/features/inbound-api/services/inbound-lead.service';
import { isEventProcessed, markEventProcessed } from '@/lib/webhooks/idempotency';

import { recordDecisionEvent, sanitizePayload } from '../services/call-priority.service';

import {
  EDGE_INGESTION_MODEL_VERSION,
  isEdgeIngestionEnabled,
  type EdgeIngestionPorts,
  type StoredIngestionEvent,
} from './edge-ingestion.service';
import { ENRICHMENT_FIELDS } from './edge-ingestion.schemas';

type Row<T> = { data: T | null; error: { message: string } | null };

const BATCH_PROVIDER = 'edge-ingestion-leads';

/** Portas reais. Toda consulta filtra org_id: o cliente de service role ignora RLS. */
export function createEdgeIngestionPorts(): EdgeIngestionPorts {
  return {
    isEnabled: isEdgeIngestionEnabled,

    async isBatchProcessed(_orgId, key) {
      try {
        return await isEventProcessed(createServiceRoleClient(), BATCH_PROVIDER, key);
      } catch {
        return 'error';
      }
    },

    async markBatchProcessed(orgId, key) {
      try {
        await markEventProcessed(createServiceRoleClient(), BATCH_PROVIDER, key, 'leads.batch', undefined, orgId);
      } catch (e) {
        console.error('[edge-ingestion/leads] mark', e instanceof Error ? e.message : 'erro');
      }
    },

    ingestLeads(orgId, leads, source) {
      return ingestInboundLeads(
        leads.map((l) => ({ ...l, lead_source: source })) as Record<string, unknown>[],
        { orgId, supabase: createServiceRoleClient(), defaultSource: 'api', onDuplicate: 'skip' },
      );
    },

    async findCall(orgId, provider, externalId) {
      try {
        const db = createServiceRoleClient();
        const idKey = provider === 'api4com' ? 'api4com_call_id' : `${provider}_call_id`;
        const cols = 'id, lead_id, status';
        const primary = (await from(db, 'calls')
          .select(cols)
          .eq('org_id', orgId)
          .eq(`metadata->>${idKey}`, externalId)
          .limit(1)) as Row<Array<{ id: string; lead_id: string | null; status: string | null }>>;
        if (primary.error) return 'error';
        let hit = primary.data?.[0];
        if (!hit && provider === 'api4com') {
          const alt = (await from(db, 'calls')
            .select(cols)
            .eq('org_id', orgId)
            .contains('metadata', { alt_api4com_ids: [externalId] })
            .limit(1)) as Row<Array<{ id: string; lead_id: string | null; status: string | null }>>;
          if (alt.error) return 'error';
          hit = alt.data?.[0];
        }
        return hit ? { callId: hit.id, leadId: hit.lead_id, status: hit.status } : null;
      } catch {
        return 'error';
      }
    },

    async loadLead(orgId, leadId) {
      try {
        const res = (await from(createServiceRoleClient(), 'leads')
          .select(['id', 'enrichment_status', ...ENRICHMENT_FIELDS].join(', '))
          .eq('id', leadId)
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .maybeSingle()) as Row<Record<string, unknown>>;
        if (res.error) return 'error';
        if (!res.data) return null;
        const values: Record<string, unknown> = {};
        for (const f of ENRICHMENT_FIELDS) values[f] = res.data[f];
        return { id: String(res.data.id), enrichment_status: (res.data.enrichment_status as string | null) ?? null, values };
      } catch {
        return 'error';
      }
    },

    async cnpjTaken(orgId, cnpj, exceptLeadId) {
      try {
        const res = (await from(createServiceRoleClient(), 'leads')
          .select('id')
          .eq('org_id', orgId)
          .eq('cnpj', cnpj)
          .neq('id', exceptLeadId)
          .is('deleted_at', null)
          .limit(1)) as Row<Array<{ id: string }>>;
        if (res.error) return 'error';
        return (res.data?.length ?? 0) > 0;
      } catch {
        return 'error';
      }
    },

    async applyEnrichment({ orgId, leadId, patch, status, provider }) {
      try {
        const db = createServiceRoleClient();
        const update: Record<string, unknown> = { ...patch };
        if (status) update.enrichment_status = status;
        if (status === 'enriched') update.enriched_at = new Date().toISOString();
        const res = (await from(db, 'leads').update(update).eq('id', leadId).eq('org_id', orgId)) as Row<unknown>;
        if (res.error) return false;
        if (status) {
          // Historico por tentativa (tabela existente). Melhor esforco: nao reprova a aplicacao.
          await from(db, 'enrichment_attempts')
            .insert({ lead_id: leadId, provider: `edge:${provider}`, status })
            .then(undefined, () => undefined);
        }
        return true;
      } catch {
        return false;
      }
    },

    async readEvent(orgId, key): Promise<StoredIngestionEvent | null | 'error'> {
      try {
        const res = (await from(createServiceRoleClient(), 'decision_events')
          .select('payload')
          .eq('org_id', orgId)
          .eq('idempotency_key', key)
          .limit(1)) as Row<Array<{ payload: Record<string, unknown> | null }>>;
        if (res.error || !res.data) return 'error';
        const payload = res.data[0]?.payload;
        if (!payload) return null;
        const reasons = Array.isArray(payload.reason_codes) ? payload.reason_codes.filter((r): r is string => typeof r === 'string') : [];
        return { disposition: String(payload.disposition ?? ''), reasons };
      } catch {
        return 'error';
      }
    },

    async recordEvent(input) {
      try {
        return await recordDecisionEvent(createServiceRoleClient(), {
          orgId: input.orgId,
          leadId: input.leadId,
          eventType: 'signal_observed',
          source: 'system',
          idempotencyKey: input.key,
          modelVersion: EDGE_INGESTION_MODEL_VERSION,
          payload: sanitizePayload({
            disposition: input.disposition,
            primary_source: 'enrichment',
            reason_codes: input.reasons,
          }),
        });
      } catch {
        return 'error';
      }
    },
  };
}
