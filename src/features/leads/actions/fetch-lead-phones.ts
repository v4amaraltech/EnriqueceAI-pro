'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { ResolvedPhone } from '@/features/activities/utils/resolve-whatsapp-phone';

interface LeadPhoneData {
  telefone: string | null;
  phones: Array<{ tipo: string; numero: string }> | null;
}

/**
 * Fetch current phone numbers for a lead (used to refresh phone list after edits).
 */
export async function fetchLeadPhones(leadId: string): Promise<ActionResult<ResolvedPhone[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data } = (await from(supabase, 'leads')
    .select('telefone, phones')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .single()) as { data: LeadPhoneData | null };

  if (!data) return { success: true, data: [] };

  const resolved: ResolvedPhone[] = [];
  const seen = new Set<string>();

  // Add phones array entries
  if (data.phones?.length) {
    for (const p of data.phones) {
      const num = p.numero?.replace(/\D/g, '');
      if (num && !seen.has(num)) {
        seen.add(num);
        resolved.push({
          raw: p.numero,
          formatted: num,
          label: `${p.tipo === 'whatsapp' ? '📱' : '📞'} ${p.numero}`,
          source: p.tipo === 'whatsapp' ? 'socio_whatsapp' : 'socio_celular',
        });
      }
    }
  }

  // Add telefone if not already included
  if (data.telefone) {
    const num = data.telefone.replace(/\D/g, '');
    if (num && !seen.has(num)) {
      resolved.push({
        raw: data.telefone,
        formatted: num,
        label: `📞 ${data.telefone}`,
        source: 'lead_telefone',
      });
    }
  }

  return { success: true, data: resolved };
}
