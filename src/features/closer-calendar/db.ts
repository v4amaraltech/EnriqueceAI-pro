import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import type { Database } from '@/lib/supabase/types';

import type { OAuthInviteRecord } from './oauth';
import { assembleCloserCalendarBoard, type CloserCalendarCard } from './status';

type Db = SupabaseClient<Database>;

export type CalendarEventKind =
  | 'invite_sent'
  | 'invite_resent'
  | 'invite_revoked'
  | 'invite_send_failed'
  | 'connected'
  | 'connection_error';

export interface CloserCalendarConnectionRow {
  id: string;
  orgId: string;
  closerId: string;
  calendarEmail: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenExpiresAt: string;
  status: 'connected' | 'error';
}

function serviceDb(): Db {
  return createServiceRoleClient();
}

export async function loadActiveCloser(
  supabase: Db,
  orgId: string,
  closerId: string,
): Promise<{ id: string; name: string; email: string } | null> {
  const { data } = (await from(supabase, 'closers')
    .select('id, name, email, deleted_at')
    .eq('id', closerId)
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { id: string; name: string; email: string | null; deleted_at: string | null } | null };
  if (!data || data.deleted_at) return null;
  return { id: data.id, name: data.name, email: data.email?.trim().toLowerCase() ?? '' };
}

export async function countCloserInvites(closerId: string): Promise<number> {
  const { count } = (await from(serviceDb(), 'closer_calendar_invites')
    .select('id', { count: 'exact', head: true })
    .eq('closer_id', closerId)) as { count: number | null };
  return count ?? 0;
}

export async function revokeOpenInvites(input: {
  orgId: string;
  closerId: string;
  actorUserId: string;
}): Promise<number> {
  const db = serviceDb();
  const { data } = (await from(db, 'closer_calendar_invites')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('closer_id', input.closerId)
    .is('used_at', null)
    .is('revoked_at', null)) as { data: Array<{ id: string }> | null };
  const ids = (data ?? []).map((row) => row.id);
  if (ids.length === 0) return 0;
  await from(db, 'closer_calendar_invites')
    .update({ revoked_at: new Date().toISOString() } as Record<string, unknown>)
    .in('id', ids);
  for (const id of ids) {
    await appendCloserCalendarEvent({
      orgId: input.orgId,
      closerId: input.closerId,
      kind: 'invite_revoked',
      detail: id,
      actorUserId: input.actorUserId,
    });
  }
  return ids.length;
}

export async function insertCloserInvite(input: {
  orgId: string;
  closerId: string;
  tokenHash: string;
  expiresAt: string;
  createdBy: string;
}): Promise<{ ok: true; id: string } | { ok: false; conflict: boolean }> {
  const { data, error } = (await from(serviceDb(), 'closer_calendar_invites')
    .insert({
      org_id: input.orgId,
      closer_id: input.closerId,
      token_hash: input.tokenHash,
      expires_at: input.expiresAt,
      created_by: input.createdBy,
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: { code?: string } | null };
  if (error || !data) return { ok: false, conflict: error?.code === '23505' };
  return { ok: true, id: data.id };
}

export async function revokeInviteById(input: {
  id: string;
  orgId: string;
  closerId: string;
  actorUserId: string | null;
  kind: 'invite_revoked' | 'invite_send_failed';
}): Promise<void> {
  await from(serviceDb(), 'closer_calendar_invites')
    .update({ revoked_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', input.id)
    .eq('org_id', input.orgId);
  await appendCloserCalendarEvent({
    orgId: input.orgId,
    closerId: input.closerId,
    kind: input.kind,
    detail: input.id,
    actorUserId: input.actorUserId,
  });
}

export async function appendCloserCalendarEvent(input: {
  orgId: string;
  closerId: string;
  kind: CalendarEventKind;
  detail?: string | null;
  actorUserId?: string | null;
}): Promise<void> {
  await from(serviceDb(), 'closer_calendar_events')
    .insert({
      org_id: input.orgId,
      closer_id: input.closerId,
      kind: input.kind,
      detail: input.detail ?? null,
      actor_user_id: input.actorUserId ?? null,
    } as Record<string, unknown>);
}

export async function loadCloserCalendarBoard(supabase: Db, orgId: string, now = new Date()): Promise<Record<string, CloserCalendarCard>> {
  const [connections, invites, events] = await Promise.all([
    from(supabase, 'closer_calendar_connections')
      .select('closer_id, status, calendar_email')
      .eq('org_id', orgId) as unknown as Promise<{ data: Array<{ closer_id: string; status: 'connected' | 'error'; calendar_email: string | null }> | null }>,
    from(supabase, 'closer_calendar_invites')
      .select('closer_id, expires_at, used_at, revoked_at, created_at')
      .eq('org_id', orgId) as unknown as Promise<{ data: Array<{ closer_id: string; expires_at: string; used_at: string | null; revoked_at: string | null; created_at: string }> | null }>,
    from(supabase, 'closer_calendar_events')
      .select('closer_id, kind, created_at')
      .eq('org_id', orgId) as unknown as Promise<{ data: Array<{ closer_id: string; kind: string; created_at: string }> | null }>,
  ]);

  return assembleCloserCalendarBoard({
    now,
    connections: (connections.data ?? []).map((row) => ({
      closerId: row.closer_id,
      status: row.status,
      calendarEmail: row.calendar_email,
    })),
    invites: (invites.data ?? []).map((row) => ({
      closerId: row.closer_id,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    })),
    events: (events.data ?? []).map((row) => ({
      closerId: row.closer_id,
      kind: row.kind,
      createdAt: row.created_at,
    })),
  });
}

interface InviteRow {
  id: string;
  org_id: string;
  closer_id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  oauth_state_hash: string | null;
  oauth_state_expires_at: string | null;
}

async function withCloser(row: InviteRow | null): Promise<OAuthInviteRecord | null> {
  if (!row) return null;
  const { data: closer } = (await from(serviceDb(), 'closers')
    .select('name, email, deleted_at')
    .eq('id', row.closer_id)
    .eq('org_id', row.org_id)
    .maybeSingle()) as { data: { name: string | null; email: string | null; deleted_at: string | null } | null };
  if (!closer || closer.deleted_at || !closer.email) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    closerId: row.closer_id,
    closerName: closer.name?.trim() || 'Closer',
    closerEmail: closer.email,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    oauthStateHash: row.oauth_state_hash,
    oauthStateExpiresAt: row.oauth_state_expires_at,
  };
}

export async function loadInviteByTokenHash(tokenHash: string): Promise<OAuthInviteRecord | null> {
  const { data } = (await from(serviceDb(), 'closer_calendar_invites')
    .select('id, org_id, closer_id, expires_at, used_at, revoked_at, oauth_state_hash, oauth_state_expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()) as { data: InviteRow | null };
  return withCloser(data);
}

export async function loadInviteById(inviteId: string): Promise<OAuthInviteRecord | null> {
  const { data } = (await from(serviceDb(), 'closer_calendar_invites')
    .select('id, org_id, closer_id, expires_at, used_at, revoked_at, oauth_state_hash, oauth_state_expires_at')
    .eq('id', inviteId)
    .maybeSingle()) as { data: InviteRow | null };
  return withCloser(data);
}

export async function setInviteOAuthState(input: {
  inviteId: string;
  stateHash: string;
  stateExpiresAt: string;
}): Promise<boolean> {
  const { data } = (await from(serviceDb(), 'closer_calendar_invites')
    .update({
      oauth_state_hash: input.stateHash,
      oauth_state_expires_at: input.stateExpiresAt,
    } as Record<string, unknown>)
    .eq('id', input.inviteId)
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle()) as { data: { id: string } | null };
  return !!data;
}

export async function clearInviteOAuthState(inviteId: string): Promise<void> {
  await from(serviceDb(), 'closer_calendar_invites')
    .update({
      oauth_state_hash: null,
      oauth_state_expires_at: null,
    } as Record<string, unknown>)
    .eq('id', inviteId)
    .is('used_at', null);
}

export async function markInviteUsed(inviteId: string): Promise<boolean> {
  const { data } = (await from(serviceDb(), 'closer_calendar_invites')
    .update({
      used_at: new Date().toISOString(),
      oauth_state_hash: null,
      oauth_state_expires_at: null,
    } as Record<string, unknown>)
    .eq('id', inviteId)
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle()) as { data: { id: string } | null };
  return !!data;
}

export async function saveCloserCalendarConnection(input: {
  orgId: string;
  closerId: string;
  calendarEmail: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenExpiresAt: string;
}): Promise<boolean> {
  const { error } = await from(serviceDb(), 'closer_calendar_connections')
    .upsert({
      org_id: input.orgId,
      closer_id: input.closerId,
      calendar_email: input.calendarEmail,
      access_token_encrypted: input.accessTokenEncrypted,
      refresh_token_encrypted: input.refreshTokenEncrypted,
      token_expires_at: input.tokenExpiresAt,
      status: 'connected',
      status_detail: null,
      last_error_at: null,
      connected_at: new Date().toISOString(),
    } as Record<string, unknown>, { onConflict: 'org_id,closer_id' });
  return !error;
}

export async function loadCloserOwnConnection(orgId: string, closerId: string): Promise<CloserCalendarConnectionRow | null> {
  const { data, error } = (await from(serviceDb(), 'closer_calendar_connections')
    .select('id, org_id, closer_id, calendar_email, access_token_encrypted, refresh_token_encrypted, token_expires_at, status')
    .eq('org_id', orgId)
    .eq('closer_id', closerId)
    .maybeSingle()) as {
    data: {
      id: string;
      org_id: string;
      closer_id: string;
      calendar_email: string;
      access_token_encrypted: string;
      refresh_token_encrypted: string;
      token_expires_at: string;
      status: 'connected' | 'error';
    } | null;
    error: { message?: string } | null;
  };
  if (error || !data) return null;
  return {
    id: data.id,
    orgId: data.org_id,
    closerId: data.closer_id,
    calendarEmail: data.calendar_email,
    accessTokenEncrypted: data.access_token_encrypted,
    refreshTokenEncrypted: data.refresh_token_encrypted,
    tokenExpiresAt: data.token_expires_at,
    status: data.status,
  };
}

export async function markCloserConnectionDropped(connection: CloserCalendarConnectionRow): Promise<void> {
  const { data } = (await from(serviceDb(), 'closer_calendar_connections')
    .update({
      status: 'error',
      status_detail: 'token_revogado',
      last_error_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', connection.id)
    .eq('status', 'connected')
    .select('id')
    .maybeSingle()) as { data: { id: string } | null };
  if (!data) return;
  await appendCloserCalendarEvent({
    orgId: connection.orgId,
    closerId: connection.closerId,
    kind: 'connection_error',
    detail: 'token_revogado',
  });
}

export async function saveCloserAccessToken(connectionId: string, accessTokenEncrypted: string, tokenExpiresAt: string): Promise<void> {
  await from(serviceDb(), 'closer_calendar_connections')
    .update({
      access_token_encrypted: accessTokenEncrypted,
      token_expires_at: tokenExpiresAt,
      status: 'connected',
      status_detail: null,
    } as Record<string, unknown>)
    .eq('id', connectionId)
    .eq('status', 'connected');
}
