import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

const AMOSTRA = 100;
const AMOSTRA_MIN = 30;
const BOUNCE_MAX = 0.05;

/**
 * BDR-5 — Saúde das caixas do BDR: bounce > 5% nos últimos 100 envios (mín. 30)
 * pausa SÓ aquela caixa (`paused_reason`). Reativação é manual (limpar o campo).
 */
export async function checkBdrMailboxHealth(): Promise<{ success: boolean; data?: { caixas: number; pausadas: number }; error?: string }> {
  const supabase = createServiceRoleClient();
  const { data: caixas } = (await from(supabase, 'gmail_connections').select('id, org_id, user_id, email_address, paused_reason').eq('bdr_ai', true)) as { data: Array<{ id: string; org_id: string; user_id: string; email_address: string; paused_reason: string | null }> | null };
  let pausadas = 0;
  for (const c of caixas ?? []) {
    if (c.paused_reason) continue;
    const { data: envios } = (await from(supabase, 'interactions').select('lead_id').eq('org_id', c.org_id).eq('performed_by', c.user_id).eq('channel', 'email').eq('type', 'sent').order('created_at', { ascending: false }).limit(AMOSTRA)) as { data: Array<{ lead_id: string }> | null };
    const ids = [...new Set((envios ?? []).map((e) => e.lead_id))];
    if ((envios?.length ?? 0) < AMOSTRA_MIN) continue;
    const { data: bounced } = (await from(supabase, 'leads').select('id').in('id', ids).not('email_bounced_at', 'is', null)) as { data: Array<{ id: string }> | null };
    const taxa = (bounced?.length ?? 0) / (envios?.length ?? 1);
    if (taxa > BOUNCE_MAX) {
      const motivo = `bounce ${(taxa * 100).toFixed(1)}% nos últimos ${envios?.length} envios (limite ${BOUNCE_MAX * 100}%)`;
      await from(supabase, 'gmail_connections').update({ paused_reason: motivo } as Record<string, unknown>).eq('id', c.id);
      pausadas++;
      console.error(`[mailbox-health] ALERTA caixa ${c.email_address} PAUSADA — ${motivo}`);
    }
  }
  return { success: true, data: { caixas: caixas?.length ?? 0, pausadas } };
}
