'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import { sendPlatformEmail } from '@/lib/email/platform-email';
import { isUuid } from '@/lib/utils/uuid';
import { getAppUrl } from '@/lib/utils/app-url';

import { CLOSER_CALENDAR_COPY } from './copy';
import { CLOSER_CALENDAR_INVITE_DAYS } from './constants';
import {
  appendCloserCalendarEvent,
  countCloserInvites,
  insertCloserInvite,
  loadActiveCloser,
  loadCloserCalendarBoard,
  revokeInviteById,
  revokeOpenInvites,
} from './db';
import { buildCloserCalendarInviteEmail } from './email';
import { isCloserCalendarConnectEnabled } from './flag';
import type { CloserCalendarCard } from './status';
import { createInviteToken } from './token';

async function manager() {
  try {
    return await getManagerOrgId();
  } catch {
    return null;
  }
}

export async function listCloserCalendarBoard(): Promise<{ enabled: boolean; byCloser: Record<string, CloserCalendarCard> }> {
  const auth = await manager();
  if (!auth) return { enabled: false, byCloser: {} };
  if (!(await isCloserCalendarConnectEnabled(auth.orgId))) return { enabled: false, byCloser: {} };
  try {
    const byCloser = await loadCloserCalendarBoard(auth.supabase, auth.orgId);
    return { enabled: true, byCloser };
  } catch (err) {
    console.error('[closer-calendar] painel indisponível', err);
    return { enabled: true, byCloser: {} };
  }
}

export async function inviteCloserCalendar(closerId: string): Promise<ActionResult<{ sent: true }>> {
  const auth = await manager();
  if (!auth) return { success: false, error: CLOSER_CALENDAR_COPY.managerOnly };
  if (!isUuid(closerId)) return { success: false, error: CLOSER_CALENDAR_COPY.invalidCloser };
  if (!(await isCloserCalendarConnectEnabled(auth.orgId))) {
    return { success: false, error: CLOSER_CALENDAR_COPY.flagOff };
  }

  try {
    const closer = await loadActiveCloser(auth.supabase, auth.orgId, closerId);
    if (!closer) return { success: false, error: CLOSER_CALENDAR_COPY.closerMissing };
    if (!closer.email) return { success: false, error: CLOSER_CALENDAR_COPY.closerEmail };

    const previous = await countCloserInvites(closerId);
    await revokeOpenInvites({ orgId: auth.orgId, closerId, actorUserId: auth.userId });

    const token = createInviteToken();
    const expiresAt = new Date(Date.now() + CLOSER_CALENDAR_INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const inserted = await insertCloserInvite({
      orgId: auth.orgId,
      closerId,
      tokenHash: token.hash,
      expiresAt,
      createdBy: auth.userId,
    });
    if (!inserted.ok) {
      return { success: false, error: CLOSER_CALENDAR_COPY.inviteOpenConflict };
    }

    const link = `${getAppUrl().replace(/\/$/, '')}/conectar-agenda/${token.raw}`;
    const email = buildCloserCalendarInviteEmail({ name: closer.name, link });
    const sent = await sendPlatformEmail({ to: closer.email, subject: email.subject, html: email.html });
    if (!sent.success) {
      await revokeInviteById({
        id: inserted.id,
        orgId: auth.orgId,
        closerId,
        actorUserId: auth.userId,
        kind: 'invite_send_failed',
      });
      return { success: false, error: CLOSER_CALENDAR_COPY.emailFailed };
    }

    await appendCloserCalendarEvent({
      orgId: auth.orgId,
      closerId,
      kind: previous > 0 ? 'invite_resent' : 'invite_sent',
      detail: inserted.id,
      actorUserId: auth.userId,
    });
    revalidatePath('/settings/prospecting/closers');
    return { success: true, data: { sent: true } };
  } catch (err) {
    console.error('[closer-calendar] convite falhou', err);
    return { success: false, error: CLOSER_CALENDAR_COPY.inviteFailed };
  }
}

export async function revokeCloserCalendarInvite(closerId: string): Promise<ActionResult<{ revoked: true }>> {
  const auth = await manager();
  if (!auth) return { success: false, error: CLOSER_CALENDAR_COPY.managerOnly };
  if (!isUuid(closerId)) return { success: false, error: CLOSER_CALENDAR_COPY.invalidCloser };
  if (!(await isCloserCalendarConnectEnabled(auth.orgId))) {
    return { success: false, error: CLOSER_CALENDAR_COPY.flagOff };
  }
  try {
    const closer = await loadActiveCloser(auth.supabase, auth.orgId, closerId);
    if (!closer) return { success: false, error: CLOSER_CALENDAR_COPY.closerMissing };
    const revoked = await revokeOpenInvites({ orgId: auth.orgId, closerId, actorUserId: auth.userId });
    if (revoked === 0) return { success: false, error: CLOSER_CALENDAR_COPY.nothingToRevoke };
    revalidatePath('/settings/prospecting/closers');
    return { success: true, data: { revoked: true } };
  } catch (err) {
    console.error('[closer-calendar] revogação falhou', err);
    return { success: false, error: CLOSER_CALENDAR_COPY.inviteFailed };
  }
}
