import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { decrypt } from '@/lib/security/encryption';
import {
  CALL_WEBHOOK_DEFAULT_URL,
  CALL_WEBHOOK_DEFAULT_VERSION,
  findCallWebhookIntegration,
  planCallWebhookRepair,
} from '@/features/integrations/services/api4com-call-webhook';

export const maxDuration = 60;

// Cron diário (pg_cron jobid 57) — rede de segurança da entrega de eventos de
// ligação. Para cada credencial API4COM conectada, garante a integração
// gateway `webhook` SEM filtro (cria se faltar; liga/tira filtro se precisar)
// — ver `planCallWebhookRepair`. NUNCA toca em outra integração.
//
// ANTES (mai–set/2026) fazia PATCH na PRIMEIRA integração da conta, trocando a
// `webhookUrl` dela pela nossa + filtro de gateway. Em vários ramais essa era a
// integração do CRM (amoCRM no 1024, Salesforce no 1033) — sobrescrevia a
// entrega de eventos do CRM todo dia, e ainda assim não funcionava para nós (o
// filtro barrava as ligações do discador, gateway `flux-{orgId}`).
//
// Body opcional: { dryRun?: boolean, orgId?: string }. O cron manda `{}` (aplica).
export async function POST(request: Request) {
  if (!verifyServiceRole(request) && !verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { dryRun?: unknown; orgId?: unknown };
  const dryRun = body.dryRun === true;
  const target = { webhookUrl: CALL_WEBHOOK_DEFAULT_URL, webhookVersion: CALL_WEBHOOK_DEFAULT_VERSION };

  const supabase = createServiceRoleClient();
  let query = from(supabase, 'api4com_connections' as never)
    .select('org_id, ramal, api_key_encrypted, base_url')
    .eq('status', 'connected')
    .order('org_id')
    .order('ramal');
  if (typeof body.orgId === 'string') query = query.eq('org_id', body.orgId);

  const { data: connections } = (await query) as {
    data: Array<{ org_id: string; ramal: string; api_key_encrypted: string | null; base_url: string }> | null;
  };

  if (!connections?.length) {
    return NextResponse.json({ message: 'No connections found', dryRun, results: [] });
  }

  // Sequencial + dedupe por credencial: ramais que dividem a mesma chave
  // (mesmas integrações) são tratados uma vez só.
  const seenCredentials = new Map<string, string>();
  const results: Array<Record<string, unknown>> = [];

  for (const conn of connections) {
    const base = { org_id: conn.org_id, ramal: conn.ramal };
    try {
      if (!conn.api_key_encrypted) {
        results.push({ ...base, error: 'sem api key' });
        continue;
      }
      const apiKey = decrypt(conn.api_key_encrypted);
      const url = `${conn.base_url.replace(/\/+$/, '')}/integrations`;
      const headers = { 'Content-Type': 'application/json', Authorization: apiKey };

      const getRes = await fetch(url, { headers });
      if (!getRes.ok) {
        results.push({ ...base, error: `GET ${getRes.status}` });
        continue;
      }
      const list = ((await getRes.json()) as unknown[]) ?? [];
      const integrations = Array.isArray(list) ? list : [];

      const credentialKey = (integrations as Array<{ id?: unknown; gateway?: unknown }>)
        .filter((i) => i?.gateway !== 'webhook' && i?.id != null)
        .map((i) => String(i.id))
        .sort()
        .join(',');
      const sameAs = credentialKey ? seenCredentials.get(credentialKey) : undefined;
      if (sameAs) {
        results.push({ ...base, action: 'skip', reason: `mesma credencial do ramal ${sameAs}` });
        continue;
      }
      if (credentialKey) seenCredentials.set(credentialKey, conn.ramal);

      const plan = planCallWebhookRepair(integrations, target);
      const urlWarning =
        plan.action !== 'create' && !plan.urlIsDefault
          ? 'integração webhook aponta para URL diferente da padrão — conferir e corrigir pela rota configure-api4com-call-webhook'
          : undefined;

      if (dryRun || plan.action === 'noop') {
        results.push({ ...base, action: plan.action, dryRun, ...(urlWarning ? { warning: urlWarning } : {}) });
        continue;
      }

      const patchRes = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(plan.body) });
      if (!patchRes.ok) {
        const text = await patchRes.text();
        results.push({ ...base, action: plan.action, error: `PATCH ${patchRes.status}: ${text.slice(0, 200)}` });
        continue;
      }

      // Verificação: relê e confere que a `webhook` ficou ligada e sem filtro.
      const verifyRes = await fetch(url, { headers });
      const after = verifyRes.ok ? findCallWebhookIntegration(((await verifyRes.json()) as unknown[]) ?? []) : null;
      const verified = after ? planCallWebhookRepair([after], target).action === 'noop' : false;

      results.push({ ...base, action: plan.action, verified, ...(urlWarning ? { warning: urlWarning } : {}) });
    } catch (err) {
      results.push({ ...base, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const changed = results.filter((r) => (r.action === 'create' || r.action === 'repair') && !dryRun).length;
  const errors = results.filter((r) => r.error).length;
  return NextResponse.json({ dryRun, total: connections.length, changed, errors, results });
}
