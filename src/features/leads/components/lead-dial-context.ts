import type { WebphoneCallContext } from '@/features/integrations/webphone/webphone-call-context';

interface LeadDialSuccess {
  success: true;
  data: { callId: string; providerCallId: string | null };
}

interface LeadDialFailure {
  success: false;
  error?: string;
}

/**
 * Contexto do painel depois do POST /calls na página do lead.
 * Falha não devolve contexto: a ligação anterior, se ainda estiver na tela,
 * permanece com as notas que o SDR não concluiu.
 */
export function contextForSuccessfulLeadCall(
  result: LeadDialSuccess | LeadDialFailure,
  lead: { id: string; nome_fantasia?: string | null; razao_social?: string | null },
  phone: string,
  dialToken: string,
): Omit<WebphoneCallContext, 'startedAt'> | null {
  if (!result.success) return null;
  return {
    callId: result.data.callId,
    providerCallId: result.data.providerCallId,
    leadId: lead.id,
    leadName: lead.nome_fantasia ?? lead.razao_social ?? null,
    phone,
    ownerHandlesResult: false,
    dialToken,
  };
}
