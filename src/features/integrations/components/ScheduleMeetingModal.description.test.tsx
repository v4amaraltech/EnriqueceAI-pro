import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_MEETING_INVITE_DESCRIPTION } from '../meeting-invite-description';
import { ScheduleMeetingModal } from './ScheduleMeetingModal';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('./WhatsAppInviteModal', () => ({ WhatsAppInviteModal: () => null }));
vi.mock('../actions/manage-calendar', () => ({ getCalendarAuthUrl: vi.fn() }));
vi.mock('@/features/activities/actions/check-whatsapp-status', () => ({ checkWhatsAppConnected: vi.fn(async () => false) }));
vi.mock('@/features/leads/actions/get-missing-meeting-fields', () => ({
  getMissingMeetingFields: vi.fn(async () => ({ success: true, data: [] })),
}));
vi.mock('@/features/settings-prospecting/actions/closers-crud', () => ({
  listClosers: vi.fn(async () => ({ success: true, data: [{ id: 'c1', name: 'Ana Closer', email: 'ana@example.com', schedulable: true }] })),
}));
vi.mock('../actions/schedule-meeting', () => ({
  scheduleMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  getLoggedUserEmail: vi.fn(async () => ({ success: true, data: 'sdr@example.com' })),
  getLeadFaturamento: vi.fn(async () => ({ success: true, data: 100_000 })),
}));

import { scheduleMeeting } from '../actions/schedule-meeting';

describe('ScheduleMeetingModal descrição do convite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(scheduleMeeting).mockResolvedValue({
      success: true,
      data: {
        id: 'event-1',
        htmlLink: 'https://calendar.google.com/event/1',
        meetLink: null,
        summary: 'V4 Company + Mercante Net',
        startTime: '2026-11-20T09:00:00',
        endTime: '2026-11-20T10:00:00',
      },
    });
  });

  it('abre com o texto oficial e manda essa descrição ao agendar', async () => {
    render(
      <ScheduleMeetingModal
        open
        onOpenChange={vi.fn()}
        leadId="lead-1"
        leadEmail="contato@mercante.example"
        leadName="Mercante Net"
      />,
    );

    expect(await screen.findByLabelText('Descrição do convite:')).toHaveValue(DEFAULT_MEETING_INVITE_DESCRIPTION);
    expect(screen.getByDisplayValue('V4 Company + Mercante Net')).toBeTruthy();
    await screen.findByRole('option', { name: /Ana Closer/ });

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c1' } });
    const day = document.querySelector('td[role="gridcell"]:not([data-disabled="true"]) button');
    if (!day) throw new Error('nenhum dia livre apareceu no calendário');
    fireEvent.click(day);
    const submit = screen.getByRole('button', { name: 'Agendar' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(scheduleMeeting).toHaveBeenCalledTimes(1));
    expect(scheduleMeeting).toHaveBeenCalledWith(
      'lead-1',
      expect.objectContaining({
        title: 'V4 Company + Mercante Net',
        description: DEFAULT_MEETING_INVITE_DESCRIPTION,
        closerId: 'c1',
        generateMeetLink: true,
      }),
      100_000,
    );
  });
});
