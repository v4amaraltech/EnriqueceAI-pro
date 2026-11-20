import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetCallResultModalExclusive } from '@/features/activities/components/call-result-modal-exclusive';

import { ActivityPhonePanel, OPERATOR_CONFIRM_MAX_WAIT_MS } from './ActivityPhonePanel';

const actions = vi.hoisted(() => ({
  initiateCall: vi.fn(),
  hangupCall: vi.fn(),
  classifyWebphoneCall: vi.fn(),
  scheduleActivity: vi.fn(),
}));
const leadAnswer = vi.hoisted(() => ({
  value: 'not_answered' as 'answered' | 'not_answered' | 'unknown',
  durationSeconds: 0,
}));

vi.mock('@/features/calls/actions/initiate-call', () => ({
  initiateCall: actions.initiateCall,
  hangupCall: actions.hangupCall,
}));
vi.mock('@/features/calls/actions/classify-webphone-call', () => ({
  classifyWebphoneCall: actions.classifyWebphoneCall,
}));
vi.mock('../actions/schedule-activity', () => ({ scheduleActivity: actions.scheduleActivity }));
vi.mock('@/features/leads/actions/lead-noshow', () => ({ markMeetingNoShow: vi.fn() }));
vi.mock('@/features/calls/hooks/use-call-hangup-detection', () => ({
  useCallHangupDetection: () => {},
}));
vi.mock('@/features/integrations/webphone/useApi4ComWebphone', () => ({
  useApi4ComWebphone: () => ({ registration: 'disabled', error: null, mic: 'unknown', call: null }),
}));
vi.mock('@/features/integrations/webphone/useWebphoneCallContext', () => ({
  useWebphoneCallContext: () => ({ notes: '' }),
}));
vi.mock('@/features/integrations/webphone/useWebphoneLeadAnswer', () => ({
  useWebphoneLeadAnswer: () => leadAnswer.value,
  useWebphoneCallOutcome: () => ({
    leadAnswer: leadAnswer.value,
    hangupCause: leadAnswer.value === 'not_answered' ? 'NUMBER_CHANGED' : null,
    durationSeconds: leadAnswer.durationSeconds,
  }),
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

const CALL_ID = '7fe4ba31-280e-4fd1-ae07-a7de46f1675b';

function panel() {
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
      onMarkDone={vi.fn()}
    />
  );
}

async function hangUp(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Ligar' }));
  await screen.findByRole('button', { name: 'Encerrar ligação' });
  await user.click(screen.getByRole('button', { name: 'Encerrar ligação' }));
  await screen.findByText(/Confirmando com a operadora/, undefined, { timeout: 5_000 });
}

// 20/11/2026: o Resultado abria "Não atendida" (versão curta) e virava a versão
// completa sozinho quando o webhook dizia que o lead atendeu. Parecia dois modais.
describe('ActivityPhonePanel espera a operadora antes do Resultado', () => {
  beforeEach(() => {
    resetCallResultModalExclusive();
    leadAnswer.value = 'unknown';
    leadAnswer.durationSeconds = 0;
    actions.initiateCall.mockResolvedValue({
      success: true,
      data: { callId: CALL_ID, providerCallId: 'prov-1' },
    });
    actions.hangupCall.mockResolvedValue({ success: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('não abre o modal até a operadora responder; abre direto na versão de atendida', async () => {
    const user = userEvent.setup();
    const { rerender } = render(panel());
    await hangUp(user);
    expect(screen.queryByRole('dialog', { name: /Resultado da Ligação/ })).toBeNull();

    leadAnswer.value = 'answered';
    leadAnswer.durationSeconds = 9;
    rerender(panel());

    await screen.findByRole('dialog', { name: /Resultado da Ligação/ });
    expect(screen.getByText(/O que aconteceu\?/)).toBeInTheDocument();
    expect(screen.queryByText(/Ninguém atendeu/)).toBeNull();
  });

  it('se a operadora não responder, abre mesmo assim depois do teto de espera', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(panel());
    await hangUp(user);
    expect(screen.queryByRole('dialog', { name: /Resultado da Ligação/ })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(OPERATOR_CONFIRM_MAX_WAIT_MS + 10);
    });
    await screen.findByRole('dialog', { name: /Resultado da Ligação/ }, { timeout: 5_000 });
  });
});
