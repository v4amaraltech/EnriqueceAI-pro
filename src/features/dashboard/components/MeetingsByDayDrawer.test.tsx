import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeetingsByDayLeads } from '../types';

const mockAction = vi.fn();
vi.mock('../actions/get-meetings-by-day-leads', () => ({
  getMeetingsByDayLeads: (...args: unknown[]) => mockAction(...args),
}));

import { MeetingsByDayDrawer, formatMeetingAt } from './MeetingsByDayDrawer';

const filters = { month: '2026-09', cadenceIds: [] as string[], userIds: [] as string[] };
const sdrNames = new Map([['s1', 'Giovanni'], ['s2', 'Matheus']]);

const payload: MeetingsByDayLeads = {
  scheduled: [
    { leadId: 'l1', razaoSocial: 'Acme LTDA', nomeFantasia: 'Acme', sdrId: 's1', at: '2026-09-14T13:05:00Z', meetingAt: '2026-09-16T17:00:00Z' },
  ],
  held: [
    { leadId: 'l2', razaoSocial: 'Beta SA', nomeFantasia: null, sdrId: 's2', at: '2026-09-14T17:30:00Z', meetingAt: '2026-09-14T17:30:00Z' },
    { leadId: 'l3', razaoSocial: null, nomeFantasia: 'Só Fantasia', sdrId: 'zzzzzzzz-desconhecido', at: '2026-09-14T18:00:00Z', meetingAt: null },
  ],
};

function renderDrawer(overrides: Partial<React.ComponentProps<typeof MeetingsByDayDrawer>> = {}) {
  return render(
    <MeetingsByDayDrawer
      open
      onOpenChange={vi.fn()}
      day={14}
      series="scheduled"
      month="2026-09"
      filters={filters}
      sdrNames={sdrNames}
      {...overrides}
    />,
  );
}

describe('formatMeetingAt', () => {
  it('mostra dia/mês e hora em BRT; sem horário vira travessão', () => {
    expect(formatMeetingAt('2026-09-14T13:05:00Z')).toBe('14/09 10:05');
    expect(formatMeetingAt('2026-09-15T01:30:00Z')).toBe('14/09 22:30');
    expect(formatMeetingAt(null)).toBe('—');
  });
});

describe('MeetingsByDayDrawer', () => {
  beforeEach(() => {
    mockAction.mockReset();
    mockAction.mockResolvedValue({ success: true, data: payload });
  });

  it('não busca nada fechado', () => {
    renderDrawer({ open: false, day: null });
    expect(mockAction).not.toHaveBeenCalled();
    expect(screen.queryByText(/Reuniões de/)).not.toBeInTheDocument();
  });

  it('busca o dia com os filtros da página e mostra as duas seções com contagem', async () => {
    renderDrawer();

    expect(screen.getByText('Reuniões de 14/09')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('1 marcada · 2 realizadas')).toBeInTheDocument());
    expect(mockAction).toHaveBeenCalledWith({ filters, day: 14 });

    expect(screen.getByText('Marcadas (RM)')).toBeInTheDocument();
    expect(screen.getByText('Realizadas (RR)')).toBeInTheDocument();
    // nome fantasia é o nome principal; razão social vira subtexto
    expect(screen.getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '/leads/l1');
    expect(screen.getByText('Acme LTDA')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Beta SA' })).toHaveAttribute('href', '/leads/l2');
    expect(screen.getByText('Giovanni')).toBeInTheDocument();
    // RM mostra a data/hora da REUNIÃO marcada (não a hora em que marcou)
    expect(screen.getByText('16/09 14:00')).toBeInTheDocument();
    expect(screen.queryByText('10:05')).not.toBeInTheDocument();
    expect(screen.getAllByText('Reunião em')).toHaveLength(2);
    expect(screen.getByText('14/09 14:30')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    // sem razão social fica só o nome fantasia; SDR fora do ranking cai no id curto
    expect(screen.getByRole('link', { name: 'Só Fantasia' })).toHaveAttribute('href', '/leads/l3');
    expect(screen.getByText('zzzzzzzz')).toBeInTheDocument();
  });

  it('a série clicada vem primeiro', async () => {
    renderDrawer({ series: 'held' });
    await waitFor(() => expect(screen.getByText('Marcadas (RM)')).toBeInTheDocument());
    const sections = document.querySelectorAll('section[data-slot^="meetings-day-section-"]');
    expect(sections[0]?.getAttribute('data-slot')).toBe('meetings-day-section-held');
    expect(sections[1]?.getAttribute('data-slot')).toBe('meetings-day-section-scheduled');
  });

  it('mostra estado vazio por seção', async () => {
    mockAction.mockResolvedValue({ success: true, data: { scheduled: [], held: [] } });
    renderDrawer();
    await waitFor(() => expect(screen.getByText('Nenhuma reunião marcada neste dia')).toBeInTheDocument());
    expect(screen.getByText('Nenhuma reunião realizada neste dia')).toBeInTheDocument();
    expect(screen.getByText('0 marcadas · 0 realizadas')).toBeInTheDocument();
  });

  it('mostra o erro da action', async () => {
    mockAction.mockResolvedValue({ success: false, error: 'Erro ao buscar os leads do dia' });
    renderDrawer();
    await waitFor(() => expect(screen.getByText('Erro ao buscar os leads do dia')).toBeInTheDocument());
  });
});
