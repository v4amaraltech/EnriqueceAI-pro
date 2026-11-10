export type CloserCalendarUiStatus = 'connected' | 'pending' | 'expired' | 'error' | 'none';

export interface CloserCalendarInviteView {
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}

export interface CloserCalendarConnectionView {
  status: 'connected' | 'error';
}

export interface CloserCalendarCard {
  status: CloserCalendarUiStatus;
  label: string;
  warning: string | null;
  calendarEmail: string | null;
}

const LABELS: Record<CloserCalendarUiStatus, string> = {
  connected: 'Conectado',
  pending: 'Convite pendente',
  expired: 'Convite expirado',
  error: 'Desconectado',
  none: 'Agenda não conectada',
};

export const CONNECTION_DROPPED_WARNING = 'A conexão com o Google caiu. Reenvie o convite.';

export function assembleCloserCalendarBoard(input: {
  now: Date;
  connections: Array<{ closerId: string; status: 'connected' | 'error'; calendarEmail: string | null }>;
  invites: Array<CloserCalendarInviteView & { closerId: string; createdAt: string }>;
  events: Array<{ closerId: string; kind: string; createdAt: string }>;
}): Record<string, CloserCalendarCard> {
  const connectionByCloser = new Map(input.connections.map((row) => [row.closerId, row]));
  const inviteByCloser = new Map<string, CloserCalendarInviteView & { createdAt: string }>();
  const invites = [...input.invites].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const invite of invites) {
    if (!inviteByCloser.has(invite.closerId)) inviteByCloser.set(invite.closerId, invite);
  }
  const eventByCloser = new Map<string, { kind: string }>();
  const events = [...input.events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const event of events) {
    if (!eventByCloser.has(event.closerId)) eventByCloser.set(event.closerId, event);
  }

  const ids = new Set<string>([
    ...connectionByCloser.keys(),
    ...inviteByCloser.keys(),
    ...eventByCloser.keys(),
  ]);
  const board: Record<string, CloserCalendarCard> = {};
  for (const closerId of ids) {
    const connection = connectionByCloser.get(closerId) ?? null;
    const latestEvent = eventByCloser.get(closerId);
    board[closerId] = deriveCloserCalendarStatus({
      now: input.now,
      connection: connection
        ? { status: connection.status, calendarEmail: connection.calendarEmail }
        : null,
      invite: inviteByCloser.get(closerId) ?? null,
      connectionDropped: connection?.status === 'error' || latestEvent?.kind === 'connection_error',
    });
  }
  return board;
}

export function inviteIsOpen(invite: CloserCalendarInviteView, now: Date): boolean {
  if (invite.usedAt || invite.revokedAt) return false;
  return new Date(invite.expiresAt).getTime() > now.getTime();
}

export function deriveCloserCalendarStatus(input: {
  now: Date;
  connection: (CloserCalendarConnectionView & { calendarEmail?: string | null }) | null;
  invite: CloserCalendarInviteView | null;
  connectionDropped: boolean;
}): CloserCalendarCard {
  const email = input.connection?.calendarEmail ?? null;
  if (input.connection?.status === 'connected') {
    return { status: 'connected', label: LABELS.connected, warning: null, calendarEmail: email };
  }

  if (input.invite && inviteIsOpen(input.invite, input.now)) {
    return {
      status: 'pending',
      label: LABELS.pending,
      warning: input.connectionDropped ? CONNECTION_DROPPED_WARNING : null,
      calendarEmail: email,
    };
  }

  if (input.connection?.status === 'error' || input.connectionDropped) {
    return { status: 'error', label: LABELS.error, warning: CONNECTION_DROPPED_WARNING, calendarEmail: email };
  }

  if (input.invite && !input.invite.usedAt && !input.invite.revokedAt) {
    return { status: 'expired', label: LABELS.expired, warning: null, calendarEmail: email };
  }

  return { status: 'none', label: LABELS.none, warning: null, calendarEmail: email };
}
