import { describe, expect, it } from 'vitest';

import { CLOSER_CALENDAR_COPY } from './copy';
import { buildCloserCalendarInviteEmail } from './email';
import { assembleCloserCalendarBoard, deriveCloserCalendarStatus } from './status';

const NOW = new Date('2026-11-10T12:00:00.000Z');

describe('status visível ao gestor', () => {
  it('conectado, pendente, expirado, desconectado e sem convite', () => {
    expect(deriveCloserCalendarStatus({
      now: NOW,
      connection: { status: 'connected', calendarEmail: 'ana@example.com' },
      invite: null,
      connectionDropped: false,
    })).toMatchObject({ status: 'connected', calendarEmail: 'ana@example.com', warning: null });

    expect(deriveCloserCalendarStatus({
      now: NOW,
      connection: null,
      invite: { expiresAt: '2026-11-17T12:00:00.000Z', usedAt: null, revokedAt: null },
      connectionDropped: false,
    }).status).toBe('pending');

    expect(deriveCloserCalendarStatus({
      now: NOW,
      connection: null,
      invite: { expiresAt: '2026-11-01T12:00:00.000Z', usedAt: null, revokedAt: null },
      connectionDropped: false,
    }).status).toBe('expired');

    expect(deriveCloserCalendarStatus({
      now: NOW,
      connection: { status: 'error' },
      invite: null,
      connectionDropped: true,
    })).toMatchObject({ status: 'error', warning: expect.stringContaining('caiu') });

    expect(deriveCloserCalendarStatus({
      now: NOW,
      connection: null,
      invite: { expiresAt: '2026-11-17T12:00:00.000Z', usedAt: '2026-11-10T11:00:00.000Z', revokedAt: null },
      connectionDropped: false,
    }).status).toBe('none');
  });

  it('depois que a conexão cai, um convite novo fica pendente e o aviso continua', () => {
    const board = assembleCloserCalendarBoard({
      now: NOW,
      connections: [{ closerId: 'c1', status: 'error', calendarEmail: 'ana@example.com' }],
      invites: [
        { closerId: 'c1', expiresAt: '2026-11-01T00:00:00.000Z', usedAt: null, revokedAt: '2026-11-09T00:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z' },
        { closerId: 'c1', expiresAt: '2026-11-17T00:00:00.000Z', usedAt: null, revokedAt: null, createdAt: '2026-11-10T00:00:00.000Z' },
      ],
      events: [
        { closerId: 'c1', kind: 'connection_error', createdAt: '2026-11-09T00:00:00.000Z' },
        { closerId: 'c1', kind: 'invite_resent', createdAt: '2026-11-10T00:00:00.000Z' },
      ],
    });
    expect(board.c1?.status).toBe('pending');
    expect(board.c1?.warning).toContain('Reenvie o convite');
  });
});

describe('texto do e-mail e da tela', () => {
  it('é curto, em português, e não usa travessão', () => {
    const email = buildCloserCalendarInviteEmail({
      name: 'Ana <script>',
      link: 'https://app.example.com/conectar-agenda/abc',
    });
    const texts = [email.subject, email.html, ...Object.values(CLOSER_CALENDAR_COPY)];
    for (const text of texts) {
      expect(text).not.toMatch(/[—–]/);
    }
    expect(email.subject).toBe('Conecte sua agenda do Google');
    expect(email.html).toContain('7 dias');
    expect(email.html).toContain('https://app.example.com/conectar-agenda/abc');
    expect(email.html).toContain('Não pedimos acesso ao Gmail');
    expect(email.html).toContain('Ana &lt;script&gt;');
    expect(email.html).not.toContain('<script>');
  });
});
