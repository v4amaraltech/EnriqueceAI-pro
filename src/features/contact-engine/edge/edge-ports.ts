import { callRpc } from '@/features/bdr-steps/actions/rpc';
import { escolherCelular } from '@/features/bdr-steps/services/whatsapp-step';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { recordDecisionEvent, sanitizePayload } from '../services/call-priority.service';
import { getContactAccess } from '../services/ownership.service';
import { evaluateSend } from '../services/send-decision.service';

import {
  EDGE_MODEL_VERSION,
  isEdgeAdapterEnabled,
  type DelegateKind,
  type EdgePorts,
  type StoredEvent,
  type TargetResult,
} from './edge-command.service';

type Row<T> = { data: T | null; error: { message: string } | null };

interface ExecRow { execution_id: string; enrollment_id: string; step_id: string; channel: string; confirmed_at: string | null }
interface LeadRow { id: string; email: string | null; telefone: string | null; phones: unknown; assigned_to: string | null }

const LEAD_COLUMNS = 'id, email, telefone, phones, assigned_to';

/** Portas reais. `delegate` e entregue pela rota, que e quem importa os handlers legados. */
export function createEdgePorts(delegate: EdgePorts['delegate']): EdgePorts {
  return {
    isEnabled: isEdgeAdapterEnabled,

    // Toda consulta filtra por org_id: o cliente de service role ignora RLS.
    async resolveTarget(orgId, ref): Promise<TargetResult> {
      try {
        const db = createServiceRoleClient();
        let leadId: string;
        let enrollmentId: string | null = null;
        let stepId: string | null = null;
        let executionId: string | null = null;

        if (ref.workflow === 'ana_email_agent') {
          leadId = String(ref.leadId);
        } else {
          const exec = (await from(db, 'cadence_step_executions')
            .select('execution_id, enrollment_id, step_id, channel, confirmed_at')
            .eq('execution_id', String(ref.executionId))
            .eq('org_id', orgId)
            .maybeSingle()) as Row<ExecRow>;
          if (exec.error) return { ok: false, reason: 'error' };
          if (!exec.data) return { ok: false, reason: 'not_found' };
          const expected = ref.workflow === 'ana_whatsapp' ? 'whatsapp' : 'email';
          if (exec.data.channel !== expected) return { ok: false, reason: 'wrong_channel' };
          if (exec.data.confirmed_at) return { ok: false, reason: 'already_confirmed' };
          const enr = (await from(db, 'cadence_enrollments')
            .select('lead_id')
            .eq('id', exec.data.enrollment_id)
            .eq('org_id', orgId)
            .maybeSingle()) as Row<{ lead_id: string }>;
          if (enr.error) return { ok: false, reason: 'error' };
          if (!enr.data) return { ok: false, reason: 'not_found' };
          leadId = enr.data.lead_id;
          enrollmentId = exec.data.enrollment_id;
          stepId = exec.data.step_id;
          executionId = exec.data.execution_id;
        }

        const lead = (await from(db, 'leads')
          .select(LEAD_COLUMNS)
          .eq('id', leadId)
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .maybeSingle()) as Row<LeadRow>;
        if (lead.error) return { ok: false, reason: 'error' };
        if (!lead.data) return { ok: false, reason: 'not_found' };

        const contact =
          ref.workflow === 'ana_whatsapp'
            ? (escolherCelular(lead.data.telefone, lead.data.phones) ?? '')
            : (lead.data.email ?? '');
        return {
          ok: true,
          target: { leadId: lead.data.id, enrollmentId, stepId, executionId, contact, assignedTo: lead.data.assigned_to },
        };
      } catch {
        return { ok: false, reason: 'error' };
      }
    },

    evaluate: (request) => evaluateSend(request),

    async readEvent(orgId, key): Promise<StoredEvent | null | 'error'> {
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
          modelVersion: EDGE_MODEL_VERSION,
          payload: sanitizePayload({
            disposition: input.disposition,
            primary_source: input.workflow,
            reason_codes: input.reasons ?? [],
          }),
        });
      } catch {
        return 'error';
      }
    },

    // Mesmo RPC e mesmos eventos que as rotas /bdr/steps usam para "pulado" e "bloqueado".
    async skipStep({ orgId, executionId, workflow, performedBy, motivo }) {
      try {
        await callRpc(createServiceRoleClient(), 'confirm_email_step', {
          p_org_id: orgId,
          p_execution_id: executionId,
          p_evento: workflow === 'ana_whatsapp' ? 'whatsapp_pulado' : 'email_falhou',
          p_performed_by: performedBy,
          p_gmail_message_id: null,
          p_conteudo: `Envio não realizado (gateway): ${motivo}.`,
          p_metadata: { motivo, origem: 'edge_command_v1' },
          p_interaction_id: null,
        });
        return true;
      } catch {
        return false;
      }
    },

    delegate: delegate as (kind: DelegateKind, body: Record<string, unknown>) => ReturnType<EdgePorts['delegate']>,

    async findLeadsByPhone(orgId, digits) {
      try {
        const { data, error } = (await createServiceRoleClient().rpc(
          'find_lead_ids_by_phone' as never,
          { p_org_id: orgId, p_phone_digits: digits } as never,
        )) as unknown as { data: string[] | null; error: { message: string } | null };
        if (error) return null;
        return (data ?? []).filter(Boolean);
      } catch {
        return null;
      }
    },

    access: ({ orgId, leadId, contact }) => getContactAccess({ orgId, leadId, contact, channel: 'whatsapp' }),
  };
}
