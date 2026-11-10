import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_MEETING_INVITE_DESCRIPTION } from '@/features/integrations/meeting-invite-description';

import { LeadScheduleTab } from './LeadScheduleTab';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/features/integrations/actions/manage-calendar', () => ({ getCalendarAuthUrl: vi.fn() }));
vi.mock('@/features/leads/actions/get-missing-meeting-fields', () => ({
  getMissingMeetingFields: vi.fn(async () => ({ success: true, data: [] })),
}));
vi.mock('@/features/settings-prospecting/actions/closers-crud', () => ({
  listClosers: vi.fn(async () => ({ success: true, data: [{ id: 'c1', name: 'Ana Closer', email: 'ana@example.com' }] })),
}));
vi.mock('@/features/integrations/actions/schedule-meeting', () => ({
  scheduleMeeting: vi.fn(),
  getLoggedUserEmail: vi.fn(async () => ({ success: true, data: 'sdr@example.com' })),
  getLeadFaturamento: vi.fn(async () => ({ success: true, data: 100_000 })),
  checkCalendarConnected: vi.fn(async () => ({ success: true, data: true })),
}));

import { scheduleMeeting } from '@/features/integrations/actions/schedule-meeting';

describe('LeadScheduleTab descrição do convite', () => {
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
        endTime: '2026-11-20T09:30:00',
      },
    });
  });

  it('pré-preenche o texto oficial e envia no agendamento do detalhe do lead', async () => {
    const view = render(<LeadScheduleTab leadId="lead-1" leadEmail="contato@mercante.example" companyName="Mercante Net" />);

    expect(await screen.findByLabelText('Descrição do convite')).toHaveValue(DEFAULT_MEETING_INVITE_DESCRIPTION);
    await screen.findByRole('option', { name: /Ana Closer/ });
    const date = view.container.querySelector('input[type="date"]');
    const time = view.container.querySelector('input[type="time"]');
    const closer = view.container.querySelectorAll('select')[1];
    if (!date || !time || !closer) throw new Error('campos do agendamento não encontrados');
    fireEvent.change(date, { target: { value: '2026-11-20' } });
    fireEvent.change(time, { target: { value: '09:00' } });
    fireEvent.change(closer, { target: { value: 'c1' } });
    const submit = screen.getByRole('button', { name: 'Agendar Reunião' });
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
        startTime: '2026-11-20T09:00:00',
      }),
      100_000,
    );
  });
});
