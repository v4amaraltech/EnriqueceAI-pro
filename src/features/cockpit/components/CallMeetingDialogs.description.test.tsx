import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_MEETING_INVITE_DESCRIPTION } from '@/features/integrations/meeting-invite-description';

import { CallMeetingConfirmDialog, type MeetingChoice, type SchedulingPreview } from './CallMeetingDialogs';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/features/integrations/components/WhatsAppInviteModal', () => ({ WhatsAppInviteModal: () => null }));
vi.mock('@/features/integrations/actions/manage-calendar', () => ({ getCalendarAuthUrl: vi.fn() }));
vi.mock('@/features/activities/actions/check-whatsapp-status', () => ({ checkWhatsAppConnected: vi.fn(async () => false) }));
vi.mock('@/features/leads/actions/get-missing-meeting-fields', () => ({ getMissingMeetingFields: vi.fn() }));
vi.mock('@/features/settings-prospecting/actions/closers-crud', () => ({ listClosers: vi.fn() }));
vi.mock('@/features/meetings/closer-availability.action', () => ({ getCloserAvailability: vi.fn() }));
vi.mock('@/features/integrations/actions/schedule-meeting', () => ({
  scheduleMeeting: vi.fn(),
  getLoggedUserEmail: vi.fn(),
  getLeadFaturamento: vi.fn(),
}));

import { scheduleMeeting } from '@/features/integrations/actions/schedule-meeting';

const choice: MeetingChoice = {
  start: new Date('2026-11-11T14:00:00.000Z'),
  end: new Date('2026-11-11T15:00:00.000Z'),
  closer: { id: 'closer-1', name: 'Closer Fixture', email: 'closer.fixture@example.com' },
};

const preview: SchedulingPreview = {
  now: new Date('2026-11-09T12:30:00.000Z'),
  organizerEmail: 'sdr.fixture@example.com',
  busy: [],
  closersSchedulable: [choice.closer],
  closersAll: [choice.closer],
};

function renderDialog() {
  return render(
    <CallMeetingConfirmDialog
      open
      choice={choice}
      leadId="lead-1"
      leadName="Mercante Net"
      leadEmail="contato@mercante.example"
      preview={preview}
      onOpenChange={vi.fn()}
      onScheduled={vi.fn()}
    />,
  );
}

describe('CallMeetingConfirmDialog descrição do convite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(scheduleMeeting).mockResolvedValue({
      success: true,
      data: {
        id: 'event-1',
        htmlLink: 'https://calendar.google.com/event/1',
        meetLink: null,
        summary: 'V4 Company + Mercante Net',
        startTime: '2026-11-11T14:00:00Z',
        endTime: '2026-11-11T15:00:00Z',
      },
    });
  });

  it('envia o texto oficial quando o SDR não altera a descrição', async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId('confirm-meeting'));
    await waitFor(() => expect(scheduleMeeting).toHaveBeenCalledTimes(1));
    expect(scheduleMeeting).toHaveBeenCalledWith(
      'lead-1',
      expect.objectContaining({
        title: 'V4 Company + Mercante Net',
        description: DEFAULT_MEETING_INVITE_DESCRIPTION,
        closerId: 'closer-1',
      }),
      1_500_000,
    );
  });

  it('pré-preenche o texto oficial e envia a edição, sem mudar título nem participantes', async () => {
    renderDialog();
    const description = screen.getByLabelText('Descrição do convite');
    expect(description).toHaveValue(DEFAULT_MEETING_INVITE_DESCRIPTION);
    expect(screen.getByLabelText('Título do convite da reunião')).toHaveValue('V4 Company + Mercante Net');

    fireEvent.change(description, { target: { value: 'Trazer o contrato.' } });
    fireEvent.click(screen.getByTestId('confirm-meeting'));

    await waitFor(() => expect(scheduleMeeting).toHaveBeenCalledTimes(1));
    expect(scheduleMeeting).toHaveBeenCalledWith(
      'lead-1',
      expect.objectContaining({
        title: 'V4 Company + Mercante Net',
        description: 'Trazer o contrato.',
        closerId: 'closer-1',
        generateMeetLink: true,
        attendeeEmails: ['contato@mercante.example', 'closer.fixture@example.com', 'sdr.fixture@example.com'],
      }),
      1_500_000,
    );
    const input = vi.mocked(scheduleMeeting).mock.calls[0]?.[1] as { startTime: string; endTime: string };
    expect(new Date(input.endTime).getTime() - new Date(input.startTime).getTime()).toBe(60 * 60 * 1000);
  });

  it('com allowOverlap envia a opção à parte, fora do input do Google, e mostra o lembrete', async () => {
    render(
      <CallMeetingConfirmDialog
        open
        choice={{ ...choice, allowOverlap: true, overlapTitle: 'Dentista' }}
        leadId="lead-1"
        leadName="Mercante Net"
        leadEmail="contato@mercante.example"
        preview={preview}
        onOpenChange={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    expect(screen.getByTestId('overlap-reminder').textContent).toContain('Dentista');
    fireEvent.click(screen.getByTestId('confirm-meeting'));
    await waitFor(() => expect(scheduleMeeting).toHaveBeenCalledTimes(1));
    expect(scheduleMeeting).toHaveBeenCalledWith(
      'lead-1',
      expect.objectContaining({ description: DEFAULT_MEETING_INVITE_DESCRIPTION, closerId: 'closer-1' }),
      1_500_000,
      { allowOverlap: true },
    );
    const input = vi.mocked(scheduleMeeting).mock.calls[0]?.[1] as unknown as Record<string, unknown>;
    expect(input).not.toHaveProperty('allowOverlap');
  });

  it('sem allowOverlap não manda o quarto argumento', async () => {
    renderDialog();
    expect(screen.queryByTestId('overlap-reminder')).toBeNull();
    fireEvent.click(screen.getByTestId('confirm-meeting'));
    await waitFor(() => expect(scheduleMeeting).toHaveBeenCalledTimes(1));
    expect(vi.mocked(scheduleMeeting).mock.calls[0]).toHaveLength(3);
  });
});
