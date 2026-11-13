import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Captura os handlers SSE (onConnected/onEnded) que o painel registra, pra
// podermos simular o encerramento da chamada dentro do teste.
const sse = vi.hoisted(() => ({ handlers: {} as { onConnected?: () => void; onEnded?: () => void } }));

vi.mock('../actions/calls', () => ({ startWhatsAppCall: vi.fn(), endWhatsAppCall: vi.fn() }));
vi.mock('../actions/persist-call', () => ({ persistWhatsAppCall: vi.fn() }));
vi.mock('../actions/apply-call-disposition', () => ({ applyCallDisposition: vi.fn() }));
vi.mock('../ringback', () => ({ startRingback: () => ({ stop: () => {} }) }));
vi.mock('../voice-call-media', () => ({
  acquireMic: vi.fn(() => Promise.resolve({})),
  releaseMic: vi.fn(),
  openCall: vi.fn(() => Promise.resolve({ getRemoteStream: () => null, close: () => {} })),
  subscribeCallEvents: vi.fn((_callId: string, handlers: typeof sse.handlers) => {
    sse.handlers = handlers;
    return () => {};
  }),
}));

// Stub leve do modal compartilhado: expõe só os gatilhos de saída, pra isolar a
// fiação de persistência do painel (o render do modal é testado à parte).
vi.mock('@/features/integrations/components/ScheduleMeetingModal', () => ({ ScheduleMeetingModal: () => null }));
vi.mock('@/features/activities/components/CallResultModal', () => ({
  CallResultModal: ({
    onClose,
    onRetry,
    onConclude,
  }: {
    onClose: () => void;
    onRetry?: (notes: string) => void;
    onConclude: (a: { notes: string; returnSchedule: null; outcome: string }) => void;
  }) => (
    <div data-testid="result-modal">
      <button onClick={() => onClose()}>stub-cancel</button>
      {onRetry && <button onClick={() => onRetry('nota-retry')}>stub-retry</button>}
      <button
        onClick={() => onConclude({ notes: 'nota-conc', returnSchedule: null, outcome: 'significant' })}
      >
        stub-conclude
      </button>
    </div>
  ),
}));

import type { ResolvedPhone } from '@/features/activities/utils/resolve-whatsapp-phone';

import { applyCallDisposition } from '../actions/apply-call-disposition';
import { startWhatsAppCall } from '../actions/calls';
import { persistWhatsAppCall } from '../actions/persist-call';
import { RECORDING_CONSENT_NOTICE } from '../constants';
import { ActivityWhatsAppCallPanel } from './ActivityWhatsAppCallPanel';

const phone: ResolvedPhone = {
  formatted: '(11) 99999-0000',
  raw: '5511999990000',
  label: '(11) 99999-0000 (Celular)',
  source: 'socio_celular',
};

function renderPanel(onResolved = vi.fn()) {
  render(
    <ActivityWhatsAppCallPanel
      enrollmentId="e1"
      stepId="s1"
      cadenceId="c1"
      leadId="l1"
      leadName="Empresa X"
      phones={[phone]}
      activityName="Ligação 1"
      callScript={null}
      onResolved={onResolved}
    />,
  );
  return { onResolved };
}

/** Discagem → chamando → encerra pela perna SSE, deixando o painel em 'ended'. */
async function dialAndEnd() {
  act(() => {
    screen.getByRole('button', { name: /Ligar via WhatsApp/ }).click();
  });
  // Espera a transição async (mic → start → openCall → subscribe) chegar em "Chamando…".
  await waitFor(() => expect(screen.getByText('Chamando…')).toBeInTheDocument());
  // O serviço sinaliza fim da chamada (não atendida) → abre o modal de resultado.
  act(() => {
    sse.handlers.onEnded?.();
  });
  await screen.findByTestId('result-modal');
}

describe('ActivityWhatsAppCallPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(startWhatsAppCall).mockResolvedValue({
      success: true,
      data: { sid: 'sid-1', callId: 'call-1' },
    });
    vi.mocked(persistWhatsAppCall).mockResolvedValue({ success: true, data: { callId: 'call-1' } });
    vi.mocked(applyCallDisposition).mockResolvedValue({
      success: true,
      data: { action: 'none' },
    });
  });

  it('renders the idle state with the recording notice and dial button', () => {
    renderPanel();
    expect(screen.getByText('Ligação 1')).toBeInTheDocument();
    expect(screen.getByText('Empresa X')).toBeInTheDocument();
    expect(screen.getByText(RECORDING_CONSENT_NOTICE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ligar via WhatsApp/ })).toBeInTheDocument();
  });

  it('persists the attempt when the SDR cancels the result modal (unanswered leaves a trace)', async () => {
    renderPanel();
    await dialAndEnd();

    act(() => {
      screen.getByText('stub-cancel').click();
    });

    await waitFor(() => expect(persistWhatsAppCall).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(persistWhatsAppCall).mock.calls[0]![0];
    expect(arg.callId).toBe('call-1');
    expect(arg.leadId).toBe('l1');
    // Cancelar não informa desfecho do SDR e a chamada não foi atendida.
    expect(arg.sdrOutcome).toBeUndefined();
    expect(arg.connected).toBe(false);
    expect(arg.disposition).toBe('not_connected');
  });

  it('persists the attempt (with notes) before re-dialing on retry', async () => {
    renderPanel();
    await dialAndEnd();

    act(() => {
      screen.getByText('stub-retry').click();
    });

    await waitFor(() => expect(persistWhatsAppCall).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(persistWhatsAppCall).mock.calls[0]![0];
    expect(arg.callId).toBe('call-1');
    expect(arg.notes).toBe('nota-retry');
    // Após o retry o painel re-disca automaticamente (não volta pra idle): o SDR
    // liga várias vezes até conectar sem sair do fluxo.
    await waitFor(() => expect(startWhatsAppCall).toHaveBeenCalledTimes(2));
  });

  it('persists the attempt with the SDR outcome on conclude', async () => {
    const { onResolved } = renderPanel();
    await dialAndEnd();

    act(() => {
      screen.getByText('stub-conclude').click();
    });

    await waitFor(() => expect(persistWhatsAppCall).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(persistWhatsAppCall).mock.calls[0]![0];
    expect(arg.callId).toBe('call-1');
    expect(arg.sdrOutcome).toBe('significant');
    expect(arg.notes).toBe('nota-conc');
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
  });
});
