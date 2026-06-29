import { requireManager } from '@/lib/auth/require-manager';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { WhatsAppNumbersManager } from '@/features/whatsapp-calls/components/WhatsAppNumbersManager';
import type { WhatsAppCallSessionStatus, WhatsAppNumberRow } from '@/features/whatsapp-calls/types';

interface MemberRow {
  user_id: string;
  role: 'manager' | 'sdr';
}

interface SessionRow {
  id: string;
  user_id: string;
  service_session_id: string;
  phone_number: string | null;
  status: WhatsAppCallSessionStatus;
  paired_at: string | null;
}

export default async function WhatsAppNumbersPage() {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  const { data: currentMember } = (await from(supabase, 'organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!currentMember) {
    return (
      <div className="mx-auto max-w-4xl p-8">
        <p className="text-muted-foreground">Organização não encontrada.</p>
      </div>
    );
  }

  const [{ data: members }, { data: sessions }] = await Promise.all([
    from(supabase, 'organization_members')
      .select('user_id, role')
      .eq('org_id', currentMember.org_id)
      .eq('status', 'active')
      .order('created_at', { ascending: true }) as unknown as Promise<{ data: MemberRow[] | null }>,
    from(supabase, 'whatsapp_call_sessions')
      .select('id, user_id, service_session_id, phone_number, status, paired_at')
      .eq('org_id', currentMember.org_id) as unknown as Promise<{ data: SessionRow[] | null }>,
  ]);

  const sessionByUser = new Map<string, SessionRow>();
  for (const s of sessions ?? []) sessionByUser.set(s.user_id, s);

  // Resolve nomes/e-mails via admin client (auth.users), como na tela de usuários.
  const admin = createAdminSupabaseClient();
  const rows: WhatsAppNumberRow[] = [];
  for (const m of members ?? []) {
    let name = m.user_id;
    try {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      const meta = data?.user?.user_metadata as { full_name?: string } | undefined;
      name = meta?.full_name || data?.user?.email || m.user_id;
    } catch {
      // mantém o user_id como fallback
    }
    const session = sessionByUser.get(m.user_id);
    rows.push({
      userId: m.user_id,
      name,
      role: m.role,
      session: session
        ? {
            id: session.id,
            serviceSessionId: session.service_session_id,
            phoneNumber: session.phone_number,
            status: session.status,
            pairedAt: session.paired_at,
          }
        : null,
    });
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-1 text-2xl font-bold">Números WhatsApp</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Pareie um número WhatsApp dedicado para cada SDR usar o discador nativo (Ligação via WhatsApp).
      </p>
      <WhatsAppNumbersManager rows={rows} />
    </div>
  );
}
