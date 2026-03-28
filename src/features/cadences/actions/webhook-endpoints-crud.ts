'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult, getManagerOrgId } from '@/lib/auth/get-org-id';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
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

const uuidSchema = z.string().uuid('ID inválido');

const createWebhookSchema = z.object({
  url: z.string().url('URL inválida').startsWith('https://', 'A URL precisa usar HTTPS'),
  secret: z.string().optional(),
  events: z.array(z.enum(VALID_EVENTS)).min(1, 'Selecione pelo menos um evento'),
});

const updateWebhookSchema = z.object({
  url: z.string().url('URL inválida').startsWith('https://', 'A URL precisa usar HTTPS').optional(),
  secret: z.string().optional(),
  events: z.array(z.enum(VALID_EVENTS)).min(1, 'Selecione pelo menos um evento').optional(),
  is_active: z.boolean().optional(),
});

export async function fetchWebhookEndpoints(): Promise<ActionResult<WebhookEndpointRow[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'webhook_endpoints')
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
  const parsed = createWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Permissão negada' };
  }

  const user = await requireAuth();

  const { data, error } = (await from(supabase, 'webhook_endpoints')
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
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: 'ID inválido' };

  const inputParsed = updateWebhookSchema.safeParse(input);
  if (!inputParsed.success) {
    return { success: false, error: inputParsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Permissão negada' };
  }

  const updateData: Record<string, unknown> = {};
  if (input.url !== undefined) updateData.url = input.url;
  if (input.secret !== undefined) updateData.secret = input.secret || null;
  if (input.events !== undefined) updateData.events = input.events;
  if (input.is_active !== undefined) updateData.is_active = input.is_active;

  const { data, error } = (await from(supabase, 'webhook_endpoints')
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
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: 'ID inválido' };

  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Permissão negada' };
  }

  const { error } = await from(supabase, 'webhook_endpoints')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) return { success: false, error: (error as { message: string }).message };
  revalidatePath('/settings/integrations');
  return { success: true, data: null };
}

export async function testWebhookEndpoint(id: string): Promise<ActionResult<{ status: number }>> {
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: 'ID inválido' };

  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Permissão negada' };
  }

  const { data: endpoint } = (await from(supabase, 'webhook_endpoints')
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
