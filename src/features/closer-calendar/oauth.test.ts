import { describe, expect, it, vi } from 'vitest';

import { CLOSER_CALENDAR_SCOPES } from './constants';
import {
  buildCloserCalendarAuthUrl,
  completeCloserCalendarOAuth,
  type OAuthInviteRecord,
} from './oauth';
import { hashSecret } from './token';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const NONCE = 'n'.repeat(43);
const INVITE_ID = '11111111-1111-4111-8111-111111111111';

function invite(patch: Partial<OAuthInviteRecord> = {}): OAuthInviteRecord {
  return {
    id: INVITE_ID,
    orgId: '22222222-2222-4222-8222-222222222222',
    closerId: '33333333-3333-4333-8333-333333333333',
    closerName: 'Ana',
    closerEmail: 'ana@example.com',
    expiresAt: '2026-11-17T12:00:00.000Z',
    usedAt: null,
    revokedAt: null,
    oauthStateHash: hashSecret(NONCE),
    oauthStateExpiresAt: '2026-11-10T12:15:00.000Z',
    ...patch,
  };
}

function harness(current = invite()) {
  const saveConnection = vi.fn(async () => true);
  const markUsed = vi.fn(async () => true);
  const clearState = vi.fn(async () => undefined);
  const exchangeCode = vi.fn(async (): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number } | null> => ({
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresIn: 3600,
  }));
  const fetchGoogleEmail = vi.fn(async () => 'ana@example.com');
  return {
    saveConnection,
    markUsed,
    clearState,
    exchangeCode,
    fetchGoogleEmail,
    run: (patch: Partial<Parameters<typeof completeCloserCalendarOAuth>[0]> = {}) => completeCloserCalendarOAuth({
      code: 'code-1',
      state: `${INVITE_ID}.${NONCE}`,
      googleError: null,
      now: NOW,
      loadInvite: async () => current,
      clearState,
      exchangeCode,
      fetchGoogleEmail,
      saveConnection,
      markUsed,
      ...patch,
    }),
  };
}

describe('OAuth da agenda do closer', () => {
  it('pede só horários livres e o e-mail, sem Gmail', () => {
    const url = new URL(buildCloserCalendarAuthUrl({
      clientId: 'client',
      appUrl: 'https://app.example.com',
      inviteId: INVITE_ID,
      nonce: NONCE,
    }));
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope.split(' ').sort()).toEqual([...CLOSER_CALENDAR_SCOPES].sort());
    expect(scope).not.toMatch(/gmail/i);
    expect(scope).not.toContain('/auth/calendar ');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/auth/callback/closer-calendar');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('conecta uma vez quando o e-mail do Google é o do closer', async () => {
    const flow = harness();
    await expect(flow.run()).resolves.toBe('ok');
    expect(flow.saveConnection).toHaveBeenCalledWith(expect.objectContaining({
      calendarEmail: 'ana@example.com',
      refreshToken: 'refresh',
    }));
    expect(flow.markUsed).toHaveBeenCalledWith(INVITE_ID);
  });

  it('não reutiliza convite usado, expirado ou revogado', async () => {
    for (const patch of [
      { usedAt: '2026-11-10T11:00:00.000Z' },
      { expiresAt: '2026-11-01T00:00:00.000Z' },
      { revokedAt: '2026-11-10T11:00:00.000Z' },
    ]) {
      const flow = harness(invite(patch));
      const status = await flow.run();
      expect(['used', 'expired', 'revoked']).toContain(status);
      expect(flow.exchangeCode).not.toHaveBeenCalled();
      expect(flow.saveConnection).not.toHaveBeenCalled();
    }
  });

  it('rejeita state trocado', async () => {
    const flow = harness();
    await expect(flow.run({ state: `${INVITE_ID}.${'x'.repeat(43)}` })).resolves.toBe('invalid');
    expect(flow.exchangeCode).not.toHaveBeenCalled();
  });

  it('não grava a conexão se a conta Google for outra e deixa o convite aberto', async () => {
    const flow = harness();
    flow.fetchGoogleEmail.mockResolvedValue('outra@example.com');
    await expect(flow.run()).resolves.toBe('mismatch');
    expect(flow.saveConnection).not.toHaveBeenCalled();
    expect(flow.markUsed).not.toHaveBeenCalled();
    expect(flow.clearState).toHaveBeenCalledWith(INVITE_ID);
  });

  it('não queima o convite se o Google não devolver refresh token', async () => {
    const flow = harness();
    flow.exchangeCode.mockResolvedValue({ accessToken: 'access', refreshToken: null, expiresIn: 3600 });
    await expect(flow.run()).resolves.toBe('error');
    expect(flow.saveConnection).not.toHaveBeenCalled();
    expect(flow.markUsed).not.toHaveBeenCalled();
  });

  it('cancelar no Google não marca o convite como usado', async () => {
    const flow = harness();
    await expect(flow.run({ googleError: 'access_denied', code: null })).resolves.toBe('denied');
    expect(flow.markUsed).not.toHaveBeenCalled();
    expect(flow.clearState).toHaveBeenCalledWith(INVITE_ID);
  });
});
