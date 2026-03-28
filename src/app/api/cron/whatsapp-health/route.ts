import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

export const maxDuration = 30;

interface WhatsAppInstance {
  id: string;
  org_id: string;
  instance_name: string;
  status: string;
}

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL ?? '';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY ?? '';

/**
 * Cron: Check WhatsApp instance health via Evolution API.
 * If a connected instance is actually disconnected, update DB and notify managers.
 */
async function checkWhatsAppHealth() {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return { checked: 0, disconnected: 0, message: 'Evolution API not configured' };
  }

  const supabase = createServiceRoleClient();

  // Find all instances marked as connected
  const { data: instances } = (await from(supabase, 'whatsapp_instances')
    .select('id, org_id, instance_name, status')
    .eq('status', 'connected')) as { data: WhatsAppInstance[] | null };

  if (!instances?.length) return { checked: 0, disconnected: 0 };

  let disconnected = 0;

  for (const instance of instances) {
    try {
      const res = await fetch(
        `${EVOLUTION_API_URL}/instance/connectionState/${instance.instance_name}`,
        { headers: { apikey: EVOLUTION_API_KEY } },
      );

      if (!res.ok) continue;

      const data = await res.json();
      const state = data?.instance?.state ?? 'unknown';

      if (state !== 'open' && state !== 'connected') {
        // Instance is disconnected — update DB
        await from(supabase, 'whatsapp_instances')
          .update({ status: 'disconnected' } as Record<string, unknown>)
          .eq('id', instance.id);

        // Notify managers
        createNotificationsForOrgMembers({
          orgId: instance.org_id,
          type: 'integration_error',
          title: 'WhatsApp desconectado',
          body: 'A conexão do WhatsApp foi perdida. Reconecte em Integrações.',
          resourceType: 'integration',
          roleFilter: 'manager',
        }).catch((err) => console.error('[whatsapp-health] Notification error:', err));

        disconnected++;
      }
    } catch (err) {
      console.error(`[whatsapp-health] Error checking ${instance.instance_name}:`, err);
    }
  }

  return { checked: instances.length, disconnected };
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await checkWhatsAppHealth();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[whatsapp-health] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
