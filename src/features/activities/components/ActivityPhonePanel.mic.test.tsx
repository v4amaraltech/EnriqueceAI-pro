import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type MicPermission,
  type WebphoneState,
  initialWebphoneState,
} from '@/features/integrations/webphone/webphone-state';

import { ActivityPhonePanel } from './ActivityPhonePanel';

// Clique em Ligar com o microfone ainda não pedido (aba recém-carregada): o
// pedido sai no mesmo gesto e só então o POST /calls é feito.

const actions = vi.hoisted(() => ({ initiateCall: vi.fn(), hangupCall: vi.fn() }));
const toasts = vi.hoisted(() => ({ error: vi.fn(), message: vi.fn() }));
const webphone = vi.hoisted(() => ({ state: null as unknown, request: vi.fn() }));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), toasts) }));
vi.mock('@/features/calls/actions/initiate-call', () => ({
  initiateCall: actions.initiateCall,
  hangupCall: actions.hangupCall,
}));
vi.mock('@/features/calls/actions/classify-webphone-call', () => ({
  classifyWebphoneCall: vi.fn(),
}));
vi.mock('../actions/schedule-activity', () => ({ scheduleActivity: vi.fn() }));
vi.mock('@/features/leads/actions/lead-noshow', () => ({ markMeetingNoShow: vi.fn() }));
vi.mock('@/features/calls/hooks/use-call-hangup-detection', () => ({
  useCallHangupDetection: () => {},
}));
vi.mock('@/features/integrations/webphone/useApi4ComWebphone', () => ({
  useApi4ComWebphone: () => webphone.state,
}));
vi.mock('@/features/integrations/webphone/webphone-client', async () => {
  const { resolveMicForDial, webphoneMicNeedsGesture } = await vi.importActual<
    typeof import('@/features/integrations/webphone/webphone-state')
  >('@/features/integrations/webphone/webphone-state');
  return {
    getWebphoneState: () => webphone.state,
    prepareWebphoneMicForDial: () => {
      const state = webphone.state as WebphoneState;
      if (!webphoneMicNeedsGesture(state)) return null;
      return resolveMicForDial(state, async () => {
        const permission = (await webphone.request()) as MicPermission;
        webphone.state = { ...state, mic: permission };
        return permission;
      });
    },
  };
});
vi.mock('@/features/integrations/webphone/useWebphoneCallContext', () => ({
  useWebphoneCallContext: () => ({ notes: '' }),
}));
vi.mock('@/features/integrations/webphone/useWebphoneLeadAnswer', () => ({
  useWebphoneLeadAnswer: () => 'unknown',
  useWebphoneCallOutcome: () => ({ leadAnswer: 'unknown', hangupCause: null, durationSeconds: 0 }),
}));
vi.mock('@/features/integrations/webphone/webphone-call-context', () => ({
  clearWebphoneCallContext: vi.fn(),
  notesRevisionForSubmit: () => 1,
  onWebphoneConcludeRequested: () => () => {},
  releaseWebphoneCallOwner: vi.fn(),
  setWebphoneCallContext: vi.fn(),
}));
vi.mock('./DockMicControl', () => ({ DockMicControl: () => null }));
vi.mock('@/features/calls/use-post-call-suggestion', () => ({
  usePostCallSuggestion: () => ({
    outcome: null,
    nextActivity: null,
    reason: null,
    source: null,
    alreadyFilled: false,
    alreadyFilledDisposition: null,
    meetingPrefill: null,
  }),
}));
vi.mock('@/features/integrations/components/ScheduleMeetingModal', () => ({
  ScheduleMeetingModal: () => null,
}));

const registered: WebphoneState = { ...initialWebphoneState, registration: 'registered' };

const onMarkDone = vi.fn();

function dock() {
  return (
    <ActivityPhonePanel
      layout="dock"
      leadName="Mercante Net"
      leadId="969ea854-1724-4f22-85a3-3633cd314553"
      phoneNumber="11954958486"
      phones={[
        { formatted: '11954958486', raw: '11954958486', label: 'Celular', source: 'lead_telefone' },
      ]}
      isSending={false}
      onMarkDone={onMarkDone}
    />
  );
}

function renderDock() {
  return render(dock());
}

describe('ActivityPhonePanel: microfone no clique em Ligar', () => {
  beforeEach(() => {
    actions.initiateCall
      .mockReset()
      .mockResolvedValue({ success: true, data: { callId: 'c-1', providerCallId: 'p-1' } });
    actions.hangupCall.mockReset().mockResolvedValue({ success: true });
    toasts.error.mockReset();
    webphone.request.mockReset();
  });

  afterEach(() => cleanup());

  it('microfone não pedido + concedido no clique: pede uma vez e liga, sem toast de bloqueio', async () => {
    webphone.state = registered;
    webphone.request.mockResolvedValue('granted');
    const user = userEvent.setup();
    renderDock();
    await user.click(screen.getByRole('button', { name: 'Ligar' }));
    await waitFor(() => expect(actions.initiateCall).toHaveBeenCalledTimes(1));
    expect(webphone.request).toHaveBeenCalledTimes(1);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('microfone não pedido + negado no clique: não liga e mostra o toast; o botão não fica preso', async () => {
    webphone.state = registered;
    webphone.request.mockResolvedValue('denied');
    const user = userEvent.setup();
    const view = renderDock();
    await user.click(screen.getByRole('button', { name: 'Ligar' }));
    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith(
        expect.stringMatching(/bloqueou o microfone/),
        expect.anything(),
      ),
    );
    expect(actions.initiateCall).not.toHaveBeenCalled();

    // Liberou no navegador e clicou em "Tentar de novo" no pill: o Ligar volta a funcionar.
    // O hook falso não re-renderiza sozinho: re-renderiza a MESMA instância
    // (a trava de clique duplo não pode ter ficado armada).
    webphone.state = { ...registered, mic: 'granted' };
    view.rerender(dock());
    await user.click(screen.getByRole('button', { name: 'Ligar' }));
    await waitFor(() => expect(actions.initiateCall).toHaveBeenCalledTimes(1));
    expect(webphone.request).toHaveBeenCalledTimes(1);
  });

  it('já negado ou indisponível: não reabre o prompt e não liga', async () => {
    const user = userEvent.setup();
    for (const mic of ['denied', 'unavailable'] as const) {
      webphone.state = { ...registered, mic };
      renderDock();
      await user.click(screen.getByRole('button', { name: 'Ligar' }));
      cleanup();
    }
    expect(webphone.request).not.toHaveBeenCalled();
    expect(actions.initiateCall).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledTimes(2);
  });

  it('microfone já concedido: liga sem pedir de novo', async () => {
    webphone.state = { ...registered, mic: 'granted' };
    const user = userEvent.setup();
    renderDock();
    await user.click(screen.getByRole('button', { name: 'Ligar' }));
    await waitFor(() => expect(actions.initiateCall).toHaveBeenCalledTimes(1));
    expect(webphone.request).not.toHaveBeenCalled();
  });
});
