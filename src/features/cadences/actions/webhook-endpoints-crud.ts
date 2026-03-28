'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult, getManagerOrgId } from '@/lib/auth/get-org-id';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface WebhookEndpointRow {
  id: string;
  org_id: string;
  url: string;
  secret: string | null;
  events: string[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_EVENTS = [
  'email.sent',
  'email.replied',
  'email.bounced',
  'whatsapp.sent',
  'whatsapp.replied',
  'whatsapp.failed',
  'enrollment.completed',
  'enrollment.paused',
  'crm.synced',
  'crm.deal_created',
  'lead.created',
  'lead.enriched',
  'lead.qualified',
  'lead.unqualified',
  'call.completed',
  'call.missed',
  'call.scheduled',
] as const;

function webhooksFrom(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  // Table not in generated types yet — cast needed
  return (supabase as Record<string, any>).from('webhook_endpoints');
}

export async function fetchWebhookEndpoints(): Promise<ActionResult<WebhookEndpointRow[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await webhooksFrom(supabase)
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })) as { data: WebhookEndpointRow[] | null; error: { message: string } | null };

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

export async function createWebhookEndpoint(input: {
  url: string;
  secret?: string;
  events: string[];
}): Promise<ActionResult<WebhookEndpointRow>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Permissão negada' };
  }

  const user = await requireAuth();

  // Validate URL
  try {
    const parsed = new URL(input.url);
    if (parsed.protocol !== 'https:') {
      return { success: false, error: 'A URL precisa usar HTTPS' };
    }
  } catch {
    return { success: false, error: 'URL inválida' };
  }

  // Validate events
  const invalidEvents = input.events.filter((e) => !(VALID_EVENTS as readonly string[]).includes(e));
  if (invalidEvents.length > 0) {
    return { success: false, error: `Eventos inválidos: ${invalidEvents.join(', ')}` };
  }

  const { data, error } = (await webhooksFrom(supabase)
    .insert({
      org_id: orgId,
      url: input.url,
      secret: input.secret || null,
      events: input.events,
      is_active: true,
      created_by: user.id,
    } as Record<string, unknown>)
    .select('*')
    .single()) as { data: WebhookEndpointRow | null; error: { message: string } | null };

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'Falha ao criar webhook endpoint' };
  revalidatePath('/settings/integrations');
  return { success: true, data };
}

export async function updateWebhookEndpoint(
  id: string,
  input: { url?: string; secret?: string; events?: string[]; is_active?: boolean },
): Promise<ActionResult<WebhookEndpointRow>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Permissão negada' };
  }

  if (input.url) {
    try {
      const parsed = new URL(input.url);
      if (parsed.protocol !== 'https:') {
        return { success: false, error: 'A URL precisa usar HTTPS' };
      }
    } catch {
      return { success: false, error: 'URL inválida' };
    }
  }

  if (input.events) {
    const invalidEvents = input.events.filter((e) => !(VALID_EVENTS as readonly string[]).includes(e));
    if (invalidEvents.length > 0) {
      return { success: false, error: `Eventos inválidos: ${invalidEvents.join(', ')}` };
    }
  }

  const updateData: Record<string, unknown> = {};
  if (input.url !== undefined) updateData.url = input.url;
  if (input.secret !== undefined) updateData.secret = input.secret || null;
  if (input.events !== undefined) updateData.events = input.events;
  if (input.is_active !== undefined) updateData.is_active = input.is_active;

  const { data, error } = (await webhooksFrom(supabase)
    .update(updateData)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('*')
    .single()) as { data: WebhookEndpointRow | null; error: { message: string } | null };

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'Webhook endpoint não encontrado' };
  revalidatePath('/settings/integrations');
  return { success: true, data };
}

export async function deleteWebhookEndpoint(id: string): Promise<ActionResult<null>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Permissão negada' };
  }

  const { error } = await webhooksFrom(supabase)
    .delete()
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) return { success: false, error: (error as { message: string }).message };
  revalidatePath('/settings/integrations');
  return { success: true, data: null };
}

export async function testWebhookEndpoint(id: string): Promise<ActionResult<{ status: number }>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Permissão negada' };
  }

  const { data: endpoint } = (await webhooksFrom(supabase)
    .select('url, secret')
    .eq('id', id)
    .eq('org_id', orgId)
    .single()) as { data: { url: string; secret: string | null } | null };

  if (!endpoint) return { success: false, error: 'Endpoint não encontrado' };

  const payload = JSON.stringify({
    event: 'test',
    timestamp: new Date().toISOString(),
    data: { message: 'Webhook test from Enriquece AI' },
  });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (endpoint.secret) {
    const crypto = await import('crypto');
    headers['X-Webhook-Signature'] =
      'sha256=' + crypto.createHmac('sha256', endpoint.secret).update(payload).digest('hex');
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { success: true, data: { status: response.status } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    return { success: false, error: `Falha ao conectar: ${message}` };
  }
}
