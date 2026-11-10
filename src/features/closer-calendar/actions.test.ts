import { beforeEach, describe, expect, it, vi } from 'vitest';

const manager = vi.fn();
const flag = vi.fn();
const sendPlatformEmail = vi.fn();
const loadActiveCloser = vi.fn();
const countCloserInvites = vi.fn();
const revokeOpenInvites = vi.fn();
const insertCloserInvite = vi.fn();
const revokeInviteById = vi.fn();
const appendCloserCalendarEvent = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/get-org-id', () => ({ getManagerOrgId: () => manager() }));
vi.mock('@/lib/email/platform-email', () => ({ sendPlatformEmail: (...args: unknown[]) => sendPlatformEmail(...args) }));
vi.mock('./flag', () => ({ isCloserCalendarConnectEnabled: (...args: unknown[]) => flag(...args) }));
vi.mock('./db', () => ({
  loadActiveCloser: (...args: unknown[]) => loadActiveCloser(...args),
  countCloserInvites: (...args: unknown[]) => countCloserInvites(...args),
  revokeOpenInvites: (...args: unknown[]) => revokeOpenInvites(...args),
  insertCloserInvite: (...args: unknown[]) => insertCloserInvite(...args),
  revokeInviteById: (...args: unknown[]) => revokeInviteById(...args),
  appendCloserCalendarEvent: (...args: unknown[]) => appendCloserCalendarEvent(...args),
  loadCloserCalendarBoard: vi.fn(),
}));

import { inviteCloserCalendar } from './actions';

const CLOSER = '33333333-3333-4333-8333-333333333333';

describe('convite do gestor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    manager.mockResolvedValue({ orgId: 'org-1', userId: 'user-1', supabase: {} });
    flag.mockResolvedValue(true);
    loadActiveCloser.mockResolvedValue({ id: CLOSER, name: 'Ana', email: 'ana@example.com' });
    countCloserInvites.mockResolvedValue(0);
    revokeOpenInvites.mockResolvedValue(0);
    insertCloserInvite.mockResolvedValue({ ok: true, id: 'invite-1' });
    sendPlatformEmail.mockResolvedValue({ success: true });
  });

  it('gestor envia o e-mail e grava só o hash', async () => {
    const result = await inviteCloserCalendar(CLOSER);
    expect(result).toEqual({ success: true, data: { sent: true } });
    const stored = insertCloserInvite.mock.calls[0]?.[0] as { tokenHash: string };
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const email = sendPlatformEmail.mock.calls[0]?.[0] as { to: string; html: string; subject: string };
    expect(email.to).toBe('ana@example.com');
    expect(email.subject).toBe('Conecte sua agenda do Google');
    expect(email.html).toContain('/conectar-agenda/');
    expect(email.html).not.toContain(stored.tokenHash);
    expect(appendCloserCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'invite_sent' }));
  });

  it('reenvio registra outro evento e não apaga o histórico', async () => {
    countCloserInvites.mockResolvedValue(2);
    await inviteCloserCalendar(CLOSER);
    expect(revokeOpenInvites).toHaveBeenCalled();
    expect(appendCloserCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'invite_resent' }));
    expect(appendCloserCalendarEvent.mock.calls.some((call) => (call[0] as { kind: string }).kind === 'invite_sent')).toBe(false);
  });

  it('não envia e-mail com a flag desligada nem para quem não é gestor', async () => {
    flag.mockResolvedValue(false);
    await expect(inviteCloserCalendar(CLOSER)).resolves.toMatchObject({ success: false });
    manager.mockRejectedValue(new Error('redirect'));
    flag.mockResolvedValue(true);
    await expect(inviteCloserCalendar(CLOSER)).resolves.toMatchObject({ success: false });
    expect(sendPlatformEmail).not.toHaveBeenCalled();
    expect(insertCloserInvite).not.toHaveBeenCalled();
  });

  it('se o e-mail falha, revoga o convite e não registra envio', async () => {
    sendPlatformEmail.mockResolvedValue({ success: false, error: 'down' });
    const result = await inviteCloserCalendar(CLOSER);
    expect(result.success).toBe(false);
    expect(revokeInviteById).toHaveBeenCalledWith(expect.objectContaining({ kind: 'invite_send_failed' }));
    expect(appendCloserCalendarEvent).not.toHaveBeenCalled();
  });
});
