// Supabase DB helpers for Evolution Edge Functions
import { supabaseAdmin } from './supabase-admin.ts';

/** Re-export admin client for functions that need it directly */
export function getServiceClient() {
  return supabaseAdmin;
}

// ---------------------------------------------------------------------------
// whatsapp_instances
// ---------------------------------------------------------------------------

/** Get the WhatsApp instance for a user (or org default).
 *  Priority: user-specific instance > org-level default (user_id IS NULL). */
export async function getWhatsAppInstance(orgId: string, userId?: string) {
  if (userId) {
    const { data } = await supabaseAdmin
      .from('whatsapp_instances')
      .select('*')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .single();
    if (data) return data;
  }

  // Fallback to org-level default
  const { data, error } = await supabaseAdmin
    .from('whatsapp_instances')
    .select('*')
    .eq('org_id', orgId)
    .is('user_id', null)
    .single();

  if (error || !data) return null;
  return data;
}

/** Get a WhatsApp instance by its Evolution instance name */
export async function getWhatsAppInstanceByName(instanceName: string) {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_instances')
    .select('*')
    .eq('instance_name', instanceName)
    .single();

  if (error || !data) return null;
  return data;
}

/** Create a new whatsapp_instances row */
export async function createWhatsAppInstance(
  orgId: string,
  instanceName: string,
  qrBase64?: string,
  userId?: string,
) {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_instances')
    .insert({
      org_id: orgId,
      instance_name: instanceName,
      status: 'connecting',
      qr_base64: qrBase64 || null,
      user_id: userId || null,
    })
    .select()
    .single();

  if (error) {
    console.error('[supabase] Error creating instance:', error);
    return null;
  }
  return data;
}

/** Update fields on a whatsapp_instances row by id */
export async function updateWhatsAppInstance(
  id: string,
  updates: Record<string, unknown>,
) {
  const { error } = await supabaseAdmin
    .from('whatsapp_instances')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('[supabase] Error updating instance:', error);
  }
}

/** Update fields on a whatsapp_instances row by instance_name */
export async function updateWhatsAppInstanceByName(
  instanceName: string,
  updates: Record<string, unknown>,
) {
  const { error } = await supabaseAdmin
    .from('whatsapp_instances')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('instance_name', instanceName);

  if (error) {
    console.error('[supabase] Error updating instance by name:', error);
  }
}

/** Get instances that need reconnection (error/disconnected, respecting backoff) */
export async function getInstancesForReconnect() {
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('whatsapp_instances')
    .select('*')
    .in('status', ['error', 'disconnected'])
    .or(`next_reconnect_at.is.null,next_reconnect_at.lte.${now}`);

  if (error) {
    console.error('[supabase] Error fetching instances for reconnect:', error);
    return [];
  }
  return data || [];
}

/** Mark all connected instances as error (Evolution API down) */
export async function markInstancesAsEvolutionDown(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_instances')
    .update({
      status: 'error',
      last_error: 'EVOLUTION_DOWN',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'connected')
    .select('id');

  if (error) {
    console.error('[supabase] Error marking instances as down:', error);
    return 0;
  }
  return data?.length || 0;
}

/** Get stale instances (not connected) older than the given threshold */
export async function getStaleInstances(thresholdMinutes: number = 30) {
  const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('whatsapp_instances')
    .select('*')
    .in('status', ['connecting', 'error', 'disconnected'])
    .lt('updated_at', threshold);

  if (error) {
    console.error('[supabase] Error fetching stale instances:', error);
    return [];
  }
  return data || [];
}

/** Delete a WhatsApp instance row by id */
export async function deleteWhatsAppInstance(id: string) {
  const { error } = await supabaseAdmin
    .from('whatsapp_instances')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[supabase] Error deleting instance:', error);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// provider_events (idempotency)
// ---------------------------------------------------------------------------

/** Check if an event has already been processed */
export async function eventExists(provider: string, eventId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('provider_events')
    .select('id')
    .eq('provider', provider)
    .eq('event_id', eventId)
    .maybeSingle();

  return !!data;
}

/** Record a processed provider event */
export async function createProviderEvent(
  _orgId: string, // kept for backwards-compat signature; not stored
  provider: string,
  eventId: string,
  eventType: string,
  payload: unknown,
) {
  const { error } = await supabaseAdmin.from('provider_events').insert({
    provider,
    event_id: eventId,
    event_type: eventType,
    payload,
  });

  if (error) {
    console.error('[supabase] Error creating provider event:', error);
  }
}
