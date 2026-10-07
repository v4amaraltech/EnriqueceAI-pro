import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { buildApolloWebhookUrl, getApolloApiKey } from '@/features/leads/services/apollo-key.service';
import { enrichPerson } from '@/features/leads/services/apollo.service';

import { decidirCelular, digitosBR, ehCelularBR, ordenarCelularPrimeiro, proximoDiaUtil9hSP, type DecisaoCelular, type TelefoneLead } from '../services/celular';

export interface ItemVerificacao { execution_id: string; lead_id: string; enrollment_id?: string | null }

export interface ResultadoVerificacao extends DecisaoCelular {
  execution_id: string;
  lead_id: string;
  revelacao: 'pedida' | 'sem_chave' | 'erro' | null;
  adiado_para: string | null;
}

type LeadRow = {
  id: string; telefone: string | null; phones: TelefoneLead[] | null; source_id: string | null; email: string | null;
  first_name: string | null; last_name: string | null; razao_social: string | null; nome_fantasia: string | null; linkedin: string | null;
};

const MARCA = 'aguardar_celular';

/**
 * BDR IA — antes de a Ana ligar para um lead sem celular brasileiro:
 * liga se já há celular em algum lugar (promovendo-o a telefone principal),
 * senão pede a revelação ao Apollo e adia o passo para o próximo dia útil;
 * esgotada a espera, liga no fixo ou encerra. Ver services/celular.ts.
 */
export async function verificarCelulares(
  supabase: SupabaseClient,
  { orgId, itens, esperaMaxDiasUteis = 3, agora = new Date() }: { orgId: string; itens: ItemVerificacao[]; esperaMaxDiasUteis?: number; agora?: Date },
): Promise<ResultadoVerificacao[]> {
  const saida: ResultadoVerificacao[] = [];
  let apiKey: string | null | undefined;
  const webhookUrl = buildApolloWebhookUrl(orgId) ?? undefined;

  for (const item of itens) {
    const base = { execution_id: item.execution_id, lead_id: item.lead_id, revelacao: null, adiado_para: null } as const;

    const { data: lead } = (await from(supabase, 'leads')
      .select('id, telefone, phones, source_id, email, first_name, last_name, razao_social, nome_fantasia, linkedin')
      .eq('id', item.lead_id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle()) as unknown as { data: LeadRow | null };
    if (!lead) {
      saida.push({ ...base, acao: 'encerrar', telefone: null, pedirRevelacao: false, motivo: 'lead não encontrado' });
      continue;
    }

    const { data: contato } = (await from(supabase, 'lead_contacts')
      .select('id, phones')
      .eq('lead_id', lead.id)
      .eq('is_primary', true)
      .maybeSingle()) as unknown as { data: { id: string; phones: TelefoneLead[] | null } | null };

    const { data: tentativas } = (await from(supabase, 'enrichment_attempts')
      .select('created_at')
      .eq('lead_id', lead.id)
      .eq('provider', 'apollo')
      .eq('response_data->>tipo', MARCA)) as unknown as { data: Array<{ created_at: string }> | null };

    const todos: TelefoneLead[] = [...(contato?.phones ?? []), ...(lead.phones ?? [])];
    const numeros = [lead.telefone, ...todos.map((p) => p.numero ?? null)];
    const d = decidirCelular({
      numeros,
      esperas: (tentativas ?? []).map((t) => new Date(t.created_at)),
      agora,
      esperaMaxDiasUteis,
    });

    // Celular existe mas não é o principal: promove (a Ana liga para o principal
    // e o painel mostra o principal). No contato, o trigger atualiza o lead.
    if (d.acao === 'ligar' && !ehCelularBR(lead.telefone)) {
      const vistos = new Set<string>();
      const unidos = todos.filter((p) => {
        const k = digitosBR(p.numero);
        if (!k || vistos.has(k)) return false;
        vistos.add(k);
        return true;
      });
      const ordenados = ordenarCelularPrimeiro(unidos);
      if (contato) {
        await from(supabase, 'lead_contacts').update({ phones: ordenados } as Record<string, unknown>).eq('id', contato.id);
      } else {
        await from(supabase, 'leads').update({ telefone: d.telefone, phones: ordenados } as Record<string, unknown>).eq('id', lead.id);
      }
    }

    if (d.acao !== 'aguardar') {
      saida.push({ ...base, ...d });
      continue;
    }

    let revelacao: ResultadoVerificacao['revelacao'] = null;
    if (d.pedirRevelacao) {
      let erro: string | null = null;
      if (apiKey === undefined) apiKey = await getApolloApiKey(orgId, supabase);
      if (!apiKey) {
        revelacao = 'sem_chave';
        erro = 'Apollo não conectado nesta organização';
      } else {
        try {
          await enrichPerson(apiKey, {
            id: lead.source_id ?? undefined,
            email: lead.email ?? undefined,
            firstName: lead.first_name ?? undefined,
            lastName: lead.last_name ?? undefined,
            organizationName: lead.nome_fantasia ?? lead.razao_social ?? undefined,
            linkedinUrl: lead.linkedin ?? undefined,
          }, webhookUrl);
          revelacao = 'pedida';
        } catch (e) {
          revelacao = 'erro';
          erro = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
        }
      }
      // Registra mesmo sem chave/erro: a data do 1º pedido é o início da espera.
      await from(supabase, 'enrichment_attempts').insert({
        lead_id: lead.id,
        provider: 'apollo',
        status: revelacao === 'pedida' ? 'enriching' : 'enrichment_failed',
        response_data: { tipo: MARCA, execution_id: item.execution_id, revelacao },
        error_message: erro,
        duration_ms: null,
      } as Record<string, unknown>);
    }

    // Tira o passo da fila até o próximo dia útil (release não mexe na data e
    // o lead voltaria a cada 15 min ocupando a reserva do executor).
    let adiado: string | null = null;
    if (item.enrollment_id) {
      const quando = proximoDiaUtil9hSP(agora).toISOString();
      const { error } = await from(supabase, 'cadence_enrollments')
        .update({ next_step_due: quando } as Record<string, unknown>)
        .eq('id', item.enrollment_id)
        .eq('org_id', orgId)
        .eq('execution_id', item.execution_id);
      if (!error) adiado = quando;
    }
    saida.push({ ...base, ...d, revelacao, adiado_para: adiado });
  }
  return saida;
}
