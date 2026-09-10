import { NextResponse } from 'next/server';

import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { decrypt } from '@/lib/security/encryption';
import { isUuid } from '@/lib/utils/uuid';
import {
  CALL_WEBHOOK_DEFAULT_VERSION,
  findCallWebhookIntegration,
  isValidCallWebhookUrl,
  planCallWebhookIntegration,
} from '@/features/integrations/services/api4com-call-webhook';
import { summarizeIntegration } from '@/features/integrations/services/api4com-diagnostics';

export const maxDuration = 60;

// Liga a entrega de eventos de ligação de uma org: cria/atualiza SÓ a
// integração `webhook` (sem filtro de gateway) de cada credencial API4COM da
// org — ver `api4com-call-webhook.ts`. Não toca nas outras integrações.
//
// Body: { orgId: uuid, webhookUrl: https, webhookVersion?: string, dryRun?: boolean }
// `dryRun` é TRUE por padrão: só aplica com `"dryRun": false` explícito.
export async function POST(request: Request) {
  if (!verifyServiceRole(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    orgId?: unknown;
    webhookUrl?: unknown;
    webhookVersion?: unknown;
    dryRun?: unknown;
  };

  if (typeof body.orgId !== 'string' || !isUuid(body.orgId)) {
    return NextResponse.json({ error: 'orgId (uuid) obrigatório' }, { status: 400 });
  }
  if (!isValidCallWebhookUrl(body.webhookUrl)) {
    return NextResponse.json({ error: 'webhookUrl https obrigatório' }, { status: 400 });
  }
  const target = {
    webhookUrl: body.webhookUrl,
    webhookVersion:
      typeof body.webhookVersion === 'string' && body.webhookVersion.trim()
        ? body.webhookVersion.trim()
        : CALL_WEBHOOK_DEFAULT_VERSION,
  };
  const dryRun = body.dryRun !== false;

  const supabase = createServiceRoleClient();
  const { data: connections } = (await from(supabase, 'api4com_connections' as never)
    .select('ramal, api_key_encrypted, base_url')
    .eq('org_id', body.orgId)
    .eq('status', 'connected')
    .order('ramal')) as {
    data: Array<{ ramal: string; api_key_encrypted: string | null; base_url: string }> | null;
  };

  if (!connections?.length) {
    return NextResponse.json({ message: 'No connections', results: [] });
  }

  // Sequencial: ramais que dividem a mesma credencial (mesmas integrações) são
  // aplicados uma vez só — o segundo vê "já feito pelo ramal X".
  const seenCredentials = new Map<string, string>();
  const results: Array<Record<string, unknown>> = [];

  for (const conn of connections) {
    try {
      if (!conn.api_key_encrypted) {
        results.push({ ramal: conn.ramal, error: 'sem api key' });
        continue;
      }
      const apiKey = decrypt(conn.api_key_encrypted);
      const url = `${conn.base_url.replace(/\/+$/, '')}/integrations`;
      const headers = { 'Content-Type': 'application/json', Authorization: apiKey };

      const getRes = await fetch(url, { headers });
      if (!getRes.ok) {
        results.push({ ramal: conn.ramal, error: `GET ${getRes.status}` });
        continue;
      }
      const integrations = (await getRes.json()) as unknown;
      const list = Array.isArray(integrations) ? integrations : [];

      // Credencial = conjunto das integrações que NÃO são a `webhook` (essa é a
      // que pode ter sido criada neste mesmo loop).
      const credentialKey = (list as Array<{ id?: unknown; gateway?: unknown }>)
        .filter((i) => i?.gateway !== 'webhook' && i?.id != null)
        .map((i) => String(i.id))
        .sort()
        .join(',');
      const sameAs = seenCredentials.get(credentialKey);
      if (credentialKey && sameAs) {
        results.push({ ramal: conn.ramal, action: 'skip', reason: `mesma credencial do ramal ${sameAs}` });
        continue;
      }
      if (credentialKey) seenCredentials.set(credentialKey, conn.ramal);

      const plan = planCallWebhookIntegration(list, target);
      const before = findCallWebhookIntegration(list);

      if (dryRun || plan.action === 'noop') {
        results.push({
          ramal: conn.ramal,
          dryRun,
          action: plan.action,
          before: before ? summarizeIntegration(before) : null,
        });
        continue;
      }

      const patchRes = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(plan.body) });
      if (!patchRes.ok) {
        const text = await patchRes.text();
        results.push({ ramal: conn.ramal, action: plan.action, error: `PATCH ${patchRes.status}: ${text.slice(0, 200)}` });
        continue;
      }

      // Verificação: relê e confere a integração `webhook`.
      const verifyRes = await fetch(url, { headers });
      const after = verifyRes.ok
        ? findCallWebhookIntegration(((await verifyRes.json()) as unknown[]) ?? [])
        : null;
      const afterPlan = after ? planCallWebhookIntegration([after], target) : null;

      results.push({
        ramal: conn.ramal,
        action: plan.action,
        before: before ? summarizeIntegration(before) : null,
        after: after ? summarizeIntegration(after) : null,
        verified: afterPlan?.action === 'noop',
      });
    } catch (err) {
      results.push({ ramal: conn.ramal, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ dryRun, target, results });
}
