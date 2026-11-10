import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  initiateCall: vi.fn(),
  hangupCall: vi.fn(),
  classifyWebphoneCall: vi.fn(),
  scheduleActivity: vi.fn(),
}));
const leadAnswer = vi.hoisted(() => ({ value: 'not_answered' as 'answered' | 'not_answered' | 'unknown' }));

vi.mock('@/features/calls/actions/initiate-call', () => ({
  initiateCall: actions.initiateCall,
  hangupCall: actions.hangupCall,
}));
vi.mock('@/features/calls/actions/classify-webphone-call', () => ({
  classifyWebphoneCall: actions.classifyWebphoneCall,
}));
vi.mock('../actions/schedule-activity', () => ({ scheduleActivity: actions.scheduleActivity }));
vi.mock('@/features/leads/actions/lead-noshow', () => ({ markMeetingNoShow: vi.fn() }));
vi.mock('@/features/calls/hooks/use-call-hangup-detection', () => ({ useCallHangupDetection: () => {} }));
vi.mock('@/features/integrations/webphone/useApi4ComWebphone', () => ({
  useApi4ComWebphone: () => ({ registration: 'disabled', error: null, mic: 'unknown', call: null }),
}));
vi.mock('@/features/integrations/webphone/useWebphoneCallContext', () => ({
  useWebphoneCallContext: () => ({ notes: '' }),
}));
vi.mock('@/features/integrations/webphone/useWebphoneLeadAnswer', () => ({
  useWebphoneLeadAnswer: () => leadAnswer.value,
}));
vi.mock('@/features/integrations/webphone/webphone-call-context', () => ({
  clearWebphoneCallContext: vi.fn(),
  notesRevisionForSubmit: () => 1,
  onWebphoneConcludeRequested: () => () => {},
  releaseWebphoneCallOwner: vi.fn(),
  setWebphoneCallContext: vi.fn(),
}));
vi.mock('./DockMicControl', () => ({ DockMicControl: () => null }));

import { ActivityPhonePanel } from './ActivityPhonePanel';

const CALL_ID = '7fe4ba31-280e-4fd1-ae07-a7de46f1675b';
const LEAD_ID = '969ea854-1724-4f22-85a3-3633cd314553';
const CADENCE = { enrollmentId: '11111111-1111-4111-8111-111111111111', stepId: '22222222-2222-4222-8222-222222222222' };

function renderDock(opts?: { cadence?: boolean }) {
  const states: string[] = [];
  const onMarkDone = vi.fn();
  render(
    <ActivityPhonePanel
      layout="dock"
      leadName="Mercante Net"
      leadId={LEAD_ID}
      phoneNumber="11954958486"
      phones={[{ formatted: '11954958486', raw: '11954958486', label: 'Celular', source: 'lead_telefone' }]}
      isSending={false}
      onMarkDone={onMarkDone}
      onSkip={vi.fn()}
      cadenceStep={opts?.cadence === false ? undefined : CADENCE}
      onCallStateChange={(state) => states.push(state)}
    />,
  );
  return { onMarkDone, states };
}

async function finishCall(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Ligar' }));
  await screen.findByRole('button', { name: 'Encerrar ligação' });
  await user.click(screen.getByRole('button', { name: 'Encerrar ligação' }));
  await screen.findByRole('dialog', { name: /Resultado da Ligação/ });
}

describe('ActivityPhonePanel pós-ligação no cockpit', () => {
  beforeEach(() => {
    leadAnswer.value = 'not_answered';
    actions.initiateCall.mockReset();
    actions.hangupCall.mockReset();
    actions.classifyWebphoneCall.mockReset();
    actions.scheduleActivity.mockReset();
    actions.initiateCall.mockResolvedValue({ success: true, data: { callId: CALL_ID, providerCallId: 'prov-1' } });
    actions.hangupCall.mockResolvedValue({ success: true });
    actions.classifyWebphoneCall.mockResolvedValue({ success: true, data: { callId: CALL_ID } });
    actions.scheduleActivity.mockResolvedValue({ success: true, data: {} });
  });

  it('falha técnica grava o desfecho e não conclui a tarefa, com ou sem passo de cadência', async () => {
    const user = userEvent.setup();
    for (const cadence of [true, false]) {
      actions.classifyWebphoneCall.mockClear();
      const { onMarkDone, states } = renderDock({ cadence });
      await finishCall(user);
      await user.click(screen.getByRole('button', { name: /Registrar outro desfecho/ }));
      await user.click(screen.getByRole('radio', { name: /Falha técnica/ }));
      await user.click(screen.getByRole('button', { name: /Registrar e voltar à fila/ }));

      await waitFor(() => expect(actions.classifyWebphoneCall).toHaveBeenCalled());
      expect(actions.classifyWebphoneCall).toHaveBeenCalledWith(
        expect.objectContaining({ callId: CALL_ID, sdrOutcome: 'technical_failure', leadId: LEAD_ID }),
      );
      expect(onMarkDone).not.toHaveBeenCalled();
      expect(actions.scheduleActivity).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Ligar' })).toBeEnabled();
      expect(states.at(-1)).toBe('idle');
      cleanup();
    }
  });

  it('falha ao gravar o desfecho técnico também não conclui a tarefa', async () => {
    const user = userEvent.setup();
    actions.classifyWebphoneCall.mockRejectedValueOnce(new Error('rede'));
    const { onMarkDone } = renderDock();
    await finishCall(user);
    await user.click(screen.getByRole('button', { name: /Registrar outro desfecho/ }));
    await user.click(screen.getByRole('radio', { name: /Falha técnica/ }));
    await user.click(screen.getByRole('button', { name: /Registrar e voltar à fila/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onMarkDone).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Ligar' })).toBeEnabled();
  });

  it('não atendida continua concluindo a tarefa e não agenda retorno', async () => {
    const user = userEvent.setup();
    const { onMarkDone } = renderDock();
    await finishCall(user);
    await user.click(screen.getByRole('button', { name: /Concluir atividade/ }));
    await waitFor(() => expect(onMarkDone).toHaveBeenCalledTimes(1));
    expect(actions.classifyWebphoneCall).toHaveBeenCalledWith(expect.objectContaining({ sdrOutcome: 'no_answer' }));
    expect(actions.scheduleActivity).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ligar de novo grava a tentativa sem concluir e disca outra vez', async () => {
    const user = userEvent.setup();
    const { onMarkDone } = renderDock();
    await finishCall(user);
    await user.click(screen.getByRole('button', { name: /Ligar de novo/ }));
    await waitFor(() => expect(actions.initiateCall).toHaveBeenCalledTimes(2));
    expect(actions.classifyWebphoneCall.mock.calls[0]?.[0]).toMatchObject({ callId: CALL_ID });
    expect(actions.classifyWebphoneCall.mock.calls[0]?.[0].sdrOutcome).toBeUndefined();
    expect(onMarkDone).not.toHaveBeenCalled();
  });

  it('retorno pausa a cadência, cria a atividade e conclui a tarefa', async () => {
    const user = userEvent.setup();
    leadAnswer.value = 'answered';
    const { onMarkDone } = renderDock();
    await finishCall(user);
    await user.click(screen.getByRole('radio', { name: /Pediu para ligar depois/ }));
    await user.click(screen.getByRole('button', { name: 'Data' }));
    const day = new Date().getDate();
    const today = screen.getAllByRole('button').find((button) => {
      const name = button.getAttribute('aria-label') ?? '';
      return new RegExp(`\\b${day}\\b`).test(name) && name.includes(String(new Date().getFullYear())) && !button.hasAttribute('disabled');
    });
    if (!today) throw new Error('dia de hoje não encontrado no calendário');
    await user.click(today);
    await user.click(screen.getByRole('button', { name: /Concluir atividade/ }));

    await waitFor(() => expect(onMarkDone).toHaveBeenCalledTimes(1));
    expect(actions.classifyWebphoneCall).toHaveBeenCalledWith(expect.objectContaining({ sdrOutcome: 'callback_requested' }));
    const scheduled = actions.scheduleActivity.mock.calls[0]?.[0];
    expect(scheduled).toMatchObject({
      leadId: LEAD_ID,
      channel: 'phone',
      pauseCadenceUntilReturn: true,
      executedStep: CADENCE,
    });
    expect(scheduled.completeEnrollments).toBeUndefined();
    expect(typeof scheduled.scheduledAt).toBe('string');
  });
});
