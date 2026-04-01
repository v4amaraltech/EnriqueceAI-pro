'use server';

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export async function checkWhatsAppConnected(): Promise<boolean> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return false;
  const { orgId, userId, supabase } = auth.data;

  // Check user-specific instance first, then org default
  const { data: userInstance } = (await from(supabase, 'whatsapp_instances' as never)
    .select('status')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'connected')
    .maybeSingle()) as { data: { status: string } | null };

  if (userInstance) return true;

  const { data: orgInstance } = (await from(supabase, 'whatsapp_instances' as never)
    .select('status')
    .eq('org_id', orgId)
    .is('user_id', null)
    .eq('status', 'connected')
    .maybeSingle()) as { data: { status: string } | null };

  // Also check Meta WhatsApp connection
  if (orgInstance) return true;

  const { data: metaConn } = (await from(supabase, 'whatsapp_connections')
    .select('id')
    .eq('org_id', orgId)
    .eq('status', 'connected')
    .maybeSingle()) as { data: { id: string } | null };

  return !!metaConn;
}
