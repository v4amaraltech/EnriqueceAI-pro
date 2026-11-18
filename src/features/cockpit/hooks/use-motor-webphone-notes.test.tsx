import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyWebphoneCall } from '@/features/calls/actions/classify-webphone-call';
import {
  getWebphoneCallContextState,
  requestWebphoneConclude,
  resetWebphoneCallContextForTests,
  setWebphoneCallContext,
  setWebphoneCallNotes,
} from '@/features/integrations/webphone/webphone-call-context';

import { useMotorWebphoneNotes } from './use-motor-webphone-notes';

vi.mock('@/features/calls/actions/classify-webphone-call', () => ({ classifyWebphoneCall: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

const CALL = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ok = { success: true as const, data: { callId: CALL, notesApplied: true } };

function conclude(callId: string, notes: string, durationSeconds = 40) {
  act(() => requestWebphoneConclude({ callId, durationSeconds, notes }));
}
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  vi.clearAllMocks();
  resetWebphoneCallContextForTests();
  vi.mocked(classifyWebphoneCall).mockResolvedValue(ok);
});

describe('Concluir do webphone grava a nota da ligação do motor', () => {
  it('com texto: grava SÓ a nota (sem desfecho) da ligação certa, com a revisão da nota', async () => {
    renderHook(() => useMotorWebphoneNotes({ live: true, callId: CALL }));
    conclude(CALL, '  pediu proposta  ');
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledTimes(1);
    const input = vi.mocked(classifyWebphoneCall).mock.calls[0]![0];
    expect(input).toMatchObject({ callId: CALL, notes: 'pediu proposta', clientDurationSeconds: 40 });
    expect(input.notesRev).toBeGreaterThanOrEqual(1);
    expect('sdrOutcome' in input).toBe(false); // nunca sobrescreve o desfecho
  });

  it('de OUTRA ligação (não é do motor): não grava', async () => {
    renderHook(() => useMotorWebphoneNotes({ live: true, callId: CALL }));
    conclude(OTHER, 'nota');
    await flush();
    expect(classifyWebphoneCall).not.toHaveBeenCalled();
  });

  it('sem texto: não grava', async () => {
    renderHook(() => useMotorWebphoneNotes({ live: true, callId: CALL }));
    conclude(CALL, '   ');
    await flush();
    expect(classifyWebphoneCall).not.toHaveBeenCalled();
  });

  it('simulado: não grava', async () => {
    renderHook(() => useMotorWebphoneNotes({ live: false, callId: CALL }));
    conclude(CALL, 'nota');
    await flush();
    expect(classifyWebphoneCall).not.toHaveBeenCalled();
  });

  it('não duplica: Concluir repetido com o mesmo texto grava uma vez; texto novo grava de novo', async () => {
    renderHook(() => useMotorWebphoneNotes({ live: true, callId: CALL }));
    conclude(CALL, 'nota');
    conclude(CALL, 'nota');
    await flush();
    conclude(CALL, 'nota');
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledTimes(1);
    conclude(CALL, 'nota corrigida');
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledTimes(2);
  });

  it('não duplica com o estacionamento: a revisão gravada fica marcada como concluída para a nota retida', async () => {
    renderHook(() => useMotorWebphoneNotes({ live: true, callId: CALL }));
    act(() => {
      setWebphoneCallContext({ callId: CALL, providerCallId: 'p', leadId: 'lead-1', leadName: 'Acme', phone: '11999990000', ownerHandlesResult: true, dialToken: 'tok' } as never);
      setWebphoneCallNotes('pediu proposta');
    });
    conclude(CALL, 'pediu proposta');
    await flush();
    const rev = vi.mocked(classifyWebphoneCall).mock.calls[0]![0].notesRev!;
    expect(getWebphoneCallContextState().concludedRev[CALL]).toBe(rev);
  });

  it('erro de gravação: avisa, NÃO marca como concluída (o texto segue no webphone) e permite tentar de novo', async () => {
    vi.mocked(classifyWebphoneCall).mockResolvedValueOnce({ success: false, error: 'Falha de rede' });
    renderHook(() => useMotorWebphoneNotes({ live: true, callId: CALL }));
    act(() => {
      setWebphoneCallContext({ callId: CALL, providerCallId: 'p', leadId: 'lead-1', leadName: 'Acme', phone: '11999990000', ownerHandlesResult: true, dialToken: 'tok' } as never);
      setWebphoneCallNotes('texto importante');
    });
    conclude(CALL, 'texto importante');
    await flush();
    expect(toast.error).toHaveBeenCalledWith('Falha de rede');
    expect(getWebphoneCallContextState().notes).toBe('texto importante');
    expect(getWebphoneCallContextState().concludedRev[CALL]).toBeUndefined();
    conclude(CALL, 'texto importante');
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledTimes(2);
  });

  it('exceção ou nota mais antiga que a gravada: avisa e mantém o texto', async () => {
    vi.mocked(classifyWebphoneCall).mockRejectedValueOnce(new Error('x'));
    renderHook(() => useMotorWebphoneNotes({ live: true, callId: CALL }));
    conclude(CALL, 'a');
    await flush();
    expect(toast.error).toHaveBeenCalledTimes(1);
    vi.mocked(classifyWebphoneCall).mockResolvedValueOnce({ success: true, data: { callId: CALL, notesApplied: false } });
    conclude(CALL, 'b');
    await flush();
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it('o SDR conclui DEPOIS de o motor seguir para outra ligação: a ligação anterior do motor ainda vale', async () => {
    const { rerender } = renderHook(({ id }) => useMotorWebphoneNotes({ live: true, callId: id }), { initialProps: { id: CALL as string | null } });
    rerender({ id: OTHER });
    conclude(CALL, 'nota da anterior');
    await flush();
    expect(vi.mocked(classifyWebphoneCall).mock.calls[0]![0]).toMatchObject({ callId: CALL });
  });
});
