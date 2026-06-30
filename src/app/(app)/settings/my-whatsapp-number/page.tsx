import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import {
  MyWhatsAppNumberCard,
  type MyWhatsAppNumber,
} from '@/features/whatsapp-calls/components/MyWhatsAppNumberCard';
import type { WhatsAppCallSessionStatus } from '@/features/whatsapp-calls/types';

interface SessionRow {
  service_session_id: string | null;
  phone_number: string | null;
  status: WhatsAppCallSessionStatus;
}

/**
 * Tela self-service do SDR: parear/reparear o PRÓPRIO número WhatsApp (discador
 * nativo). Acessível a qualquer membro autenticado — a leitura da própria sessão
 * é permitida por RLS; a escrita do pareamento usa service role escopado ao
 * próprio user_id (ver actions/pairing-self.ts).
 */
export default async function MyWhatsAppNumberPage() {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: session } = (await from(supabase, 'whatsapp_call_sessions')
    .select('service_session_id, phone_number, status')
    .eq('user_id', user.id)
    .maybeSingle()) as { data: SessionRow | null };

  const name =
    (user.user_metadata?.full_name as string | undefined) || user.email || 'Você';

  const me: MyWhatsAppNumber = {
    userId: user.id,
    name,
    session: session
      ? {
          status: session.status,
          phoneNumber: session.phone_number,
          serviceSessionId: session.service_session_id,
        }
      : null,
  };

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-1 text-2xl font-bold">Ligação via WhatsApp</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Pareie seu número WhatsApp para usar o discador nativo direto da plataforma.
      </p>
      <MyWhatsAppNumberCard me={me} />
    </div>
  );
}
