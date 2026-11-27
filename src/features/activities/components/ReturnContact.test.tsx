import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FIXTURE_ACTIVITY } from '@/app/demo/call-workspace/fixture';
import { CallSidePanel } from '@/features/cockpit/components/CallSidePanel';
import { initialWebphoneState } from '@/features/integrations/webphone/webphone-state';

import { RETURN_CONTACT_TIMEOUT_MS, returnTaskPhones } from '../hooks/useReturnContact';
import type { PendingActivity } from '../types';

// Tarefa de retorno com contato indicado: o painel de verdade abre com o número dele e disca com o contactId.

const actions = vi.hoisted(() => ({ initiateCall: vi.fn(), fetchReturnContact: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock('../actions/fetch-return-contact', () => ({
  fetchReturnContact: actions.fetchReturnContact,
}));
vi.mock('@/features/calls/actions/initiate-call', () => ({
  initiateCall: actions.initiateCall,
  hangupCall: vi.fn(),
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
  useApi4ComWebphone: () => ({
    ...initialWebphoneState,
    registration: 'registered',
    mic: 'granted',
  }),
}));
vi.mock('@/features/integrations/webphone/webphone-client', () => ({
  getWebphoneState: () => initialWebphoneState,
  hangupCall: vi.fn(),
  prepareWebphoneMicForDial: () => null,
}));
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
vi.mock('@/features/cockpit/components/use-lead-history', () => ({
  useLeadHistory: () => ({ entries: [], loading: false, error: null }),
}));
vi.mock('@/features/cockpit/components/CallHistoryList', () => ({ CallHistoryList: () => null }));
vi.mock('@/features/cockpit/components/CallMeetingDialogs', () => ({
  CallMeetingWeekDialog: () => null,
  CallMeetingConfirmDialog: () => null,
}));
vi.mock('@/features/leads/components/MarkLeadLostDialog', () => ({
  MarkLeadLostDialog: () => null,
}));

const PRINCIPAL = FIXTURE_ACTIVITY.lead.telefone as string;
const INDICATED = '11988887777';
const contact = { contactId: 'c-1', name: 'José Lima', jobTitle: 'Sócio', phone: INDICATED };
const returnTask = (stepId = 'sa-1', over: Partial<PendingActivity> = {}): PendingActivity => ({
  ...FIXTURE_ACTIVITY,
  enrollmentId: `scheduled:${stepId}`,
  stepId,
  scheduledKind: 'return',
  returnContactId: 'c-1',
  ...over,
});

const panel = (activity: PendingActivity) => (
  <CallSidePanel
    key={activity.stepId}
    activity={activity}
    dialerProvider="api4com"
    minimized={false}
    onMinimize={vi.fn()}
    onRestore={vi.fn()}
    onClose={vi.fn()}
    onMarkDone={vi.fn()}
    onLeadLost={vi.fn()}
    onScheduled={vi.fn()}
  />
);
const dial = async () => {
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Ligar' }));
  await waitFor(() => expect(actions.initiateCall).toHaveBeenCalledTimes(1));
  return actions.initiateCall.mock.calls[0]?.[0] as { phone: string; contactId: string | null };
};

beforeEach(() => {
  sessionStorage.clear();
  actions.initiateCall
    .mockReset()
    .mockResolvedValue({ success: true, data: { callId: 'x', providerCallId: 'p' } });
  actions.fetchReturnContact.mockReset().mockResolvedValue({ success: true, data: contact });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('tarefa de retorno com contato indicado', () => {
  it('abre com o número do indicado, mostra "Retorno com" e disca com o contactId', async () => {
    render(panel(returnTask()));
    expect(screen.getByTestId('return-contact-loading')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ligar' })).toBeNull();
    expect(await screen.findByTestId('callback-contact')).toHaveTextContent(
      'Retorno com José Lima',
    );
    expect(actions.fetchReturnContact).toHaveBeenCalledWith({
      scheduledActivityId: 'sa-1',
      leadId: FIXTURE_ACTIVITY.lead.id,
    });
    expect(await dial()).toMatchObject({ phone: INDICATED, contactId: 'c-1' });
  });

  it.each([
    [
      'sem telefone do indicado',
      { success: true, data: { ...contact, phone: null } },
      'ligando para o principal',
    ],
    ['já atendeu ou sem contato', { success: true, data: null }, null],
  ])('%s: disca o principal, sem contactId', async (_n, result, notice) => {
    actions.fetchReturnContact.mockResolvedValue(result);
    render(panel(returnTask()));
    expect(await dial()).toMatchObject({ phone: PRINCIPAL, contactId: null });
    if (notice) expect(screen.getByTestId('callback-contact')).toHaveTextContent(notice);
    else expect(screen.queryByTestId('callback-contact')).toBeNull();
    expect(screen.queryByTestId('return-contact-failed')).toBeNull();
  });

  it.each([
    [
      'a ação devolve erro',
      () => actions.fetchReturnContact.mockResolvedValue({ success: false, error: 'x' }),
    ],
    ['a chamada quebra', () => actions.fetchReturnContact.mockRejectedValue(new Error('rede'))],
  ])('%s: avisa e disca o principal', async (_n, arrange) => {
    arrange();
    render(panel(returnTask()));
    expect(await screen.findByTestId('return-contact-failed')).toHaveTextContent(
      'Não consegui carregar o contato do retorno. Ligando para o principal.',
    );
    expect(await dial()).toMatchObject({ phone: PRINCIPAL, contactId: null });
  });

  it('pular para a próxima tarefa não carrega o contato da anterior', async () => {
    const view = render(panel(returnTask('sa-1')));
    await screen.findByTestId('callback-contact');
    view.rerender(panel(returnTask('sa-2', { returnContactId: undefined })));
    expect(screen.queryByTestId('callback-contact')).toBeNull();
    expect(await dial()).toMatchObject({ phone: PRINCIPAL, contactId: null });
    expect(actions.fetchReturnContact).toHaveBeenCalledTimes(1);
  });

  it('sem resposta no prazo abre com o principal; a resposta atrasada não troca o número', async () => {
    vi.useFakeTimers();
    let answer: (v: unknown) => void = () => {};
    actions.fetchReturnContact.mockReturnValue(new Promise((r) => (answer = r)));
    render(panel(returnTask()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETURN_CONTACT_TIMEOUT_MS);
    });
    await act(async () => answer({ success: true, data: contact }));
    expect(screen.getByRole('button', { name: 'Ligar' })).toBeInTheDocument();
    expect(screen.queryByTestId('callback-contact')).toBeNull();
    expect(screen.getByTestId('return-contact-failed')).toBeInTheDocument();
    expect(screen.queryByText(INDICATED)).toBeNull();
  });
});

describe('returnTaskPhones', () => {
  const phone = (raw: string, contactId?: string) => ({
    formatted: raw,
    raw,
    label: raw,
    source: 'contact' as const,
    ...(contactId ? { contactId } : {}),
  });

  it('tarefa sem contato no retorno: lista intocada', () => {
    const list = [phone('1')];
    expect(
      returnTaskPhones({ returnContactId: undefined, lead: FIXTURE_ACTIVITY.lead }, list, null),
    ).toBe(list);
  });

  it('indicado na frente sem duplicar; sem indicado, o principal de hoje fica na frente', () => {
    const activity = returnTask();
    const list = [phone(INDICATED, 'c-1'), phone(PRINCIPAL, 'c-0')];
    expect(returnTaskPhones(activity, list, contact).map((p) => p.raw)).toEqual([
      INDICATED,
      PRINCIPAL,
    ]);
    expect(returnTaskPhones(activity, list, null).map((p) => p.raw)).toEqual([
      PRINCIPAL,
      INDICATED,
    ]);
    expect(returnTaskPhones(activity, list, null)[0]?.contactId).toBe('c-0');
  });
});
