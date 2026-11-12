import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { CallMeetingWeekDialog, type MeetingChoice, type SchedulingPreview } from './CallMeetingDialogs';

const LONG_TITLE = 'Reunião de alinhamento trimestral com o time comercial da Acme Indústria';

const closer = { id: 'closer-1', name: 'Closer Fixture', email: 'closer.fixture@example.com' };

/** Semana de 9 a 13/11/2026, agora = segunda 09:30 BRT. */
function preview(extra: Partial<SchedulingPreview> = {}): SchedulingPreview {
  return {
    now: new Date('2026-11-09T12:30:00.000Z'),
    organizerEmail: 'sdr.fixture@example.com',
    skipSubmit: true,
    busy: [
      { start: '2026-11-09T14:00:00.000Z', end: '2026-11-09T15:00:00.000Z', title: LONG_TITLE },
      { start: '2026-11-09T14:30:00.000Z', end: '2026-11-09T15:00:00.000Z', title: 'Outro' },
      { start: '2026-11-09T16:00:00.000Z', end: '2026-11-09T17:00:00.000Z' },
    ],
    appBusy: [{ start: '2026-11-09T18:00:00.000Z', end: '2026-11-09T19:00:00.000Z' }],
    holidays: ['2026-11-13'],
    closersSchedulable: [closer],
    closersAll: [closer],
    ...extra,
  };
}

function renderGrid(extra: Partial<SchedulingPreview> = {}) {
  const onChoose = vi.fn<(choice: MeetingChoice) => void>();
  render(<CallMeetingWeekDialog open onOpenChange={vi.fn()} preview={preview(extra)} onChoose={onChoose} />);
  return { onChoose };
}

function pickCloser() {
  fireEvent.click(screen.getByRole('button', { name: /^Closers/ }));
  fireEvent.click(screen.getByTestId('closer-closer-1'));
}

function scheduleButton() {
  return screen.getByRole('button', { name: (name) => name === 'Agendar' });
}

describe('grade do closer com títulos do Google', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mostra o título truncável, o tooltip nativo e o +N', () => {
    renderGrid();
    const cell = screen.getByTestId('slot-0-11');
    const title = screen.getByTestId('slot-title-0-11');
    expect(title.textContent).toBe(LONG_TITLE);
    expect(title.className).toContain('truncate');
    expect(title.getAttribute('title')).toBe(LONG_TITLE);
    expect(cell.textContent).toContain('+1');
    expect(cell.textContent).not.toContain('Ocupado');
    expect(cell).toBeEnabled();
    expect(cell.getAttribute('data-busy-source')).toBe('calendar');
    expect(cell.className).toContain('bg-amber-50');
  });

  it('ocupado no Google sem título (freeBusy) continua "Ocupado" e selecionável com confirmação', () => {
    renderGrid();
    const cell = screen.getByTestId('slot-0-13');
    expect(cell.textContent).toContain('Ocupado');
    expect(cell).toBeEnabled();
  });

  it('clique no ocupado do Google pede confirmação e, ao confirmar, seleciona e leva allowOverlap', () => {
    const { onChoose } = renderGrid();
    pickCloser();
    fireEvent.click(screen.getByTestId('slot-0-11'));
    const dialog = screen.getByTestId('overlap-confirm-dialog');
    expect(within(dialog).getByText(`Closer ocupado: ${LONG_TITLE}. Marcar mesmo assim?`)).toBeTruthy();
    expect(within(dialog).getByText(/Há mais 1 compromisso/)).toBeTruthy();
    expect(screen.getByTestId('slot-0-11').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Marcar mesmo assim' }));
    expect(screen.queryByTestId('overlap-confirm-dialog')).toBeNull();
    expect(screen.getByTestId('slot-0-11').getAttribute('aria-pressed')).toBe('true');
    expect(scheduleButton()).toBeEnabled();
    fireEvent.click(scheduleButton());
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0]?.[0]).toMatchObject({ allowOverlap: true, overlapTitle: LONG_TITLE, closer });
  });

  it('ao cancelar a confirmação, o horário não fica selecionado', () => {
    const { onChoose } = renderGrid();
    pickCloser();
    fireEvent.click(screen.getByTestId('slot-0-11'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByTestId('overlap-confirm-dialog')).toBeNull();
    expect(screen.getByTestId('slot-0-11').getAttribute('aria-pressed')).toBe('false');
    expect(scheduleButton()).toBeDisabled();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('confirmação sem título usa "Ocupado"', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('slot-0-13'));
    expect(screen.getByText('Closer ocupado: Ocupado. Marcar mesmo assim?')).toBeTruthy();
  });

  it('slot livre segue o fluxo de hoje, sem diálogo e sem allowOverlap', () => {
    const { onChoose } = renderGrid();
    pickCloser();
    fireEvent.click(screen.getByTestId('slot-0-14'));
    expect(screen.queryByTestId('overlap-confirm-dialog')).toBeNull();
    fireEvent.click(scheduleButton());
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0]?.[0].allowOverlap).toBeUndefined();
  });

  it('reunião do Enriquece, feriado e passado ficam bloqueados, sem diálogo', () => {
    renderGrid();
    const app = screen.getByTestId('slot-0-15');
    expect(app).toBeDisabled();
    expect(app.textContent).toContain('Ocupado');
    expect(app.getAttribute('data-busy-source')).toBe('app');
    fireEvent.click(app);
    const holiday = screen.getByTestId('slot-4-11');
    expect(holiday).toBeDisabled();
    expect(holiday.textContent).toContain('Feriado');
    fireEvent.click(holiday);
    const past = screen.getByTestId('slot-0-9');
    expect(past).toBeDisabled();
    fireEvent.click(past);
    expect(screen.queryByTestId('overlap-confirm-dialog')).toBeNull();
  });

  it('"Sem dados" continua igual e não abre confirmação', () => {
    renderGrid({ unknownAll: true });
    const cell = screen.getByTestId('slot-0-11');
    expect(cell.textContent).toContain('Sem dados');
    expect(cell.textContent).not.toContain(LONG_TITLE);
    expect(cell).toBeDisabled();
    fireEvent.click(cell);
    expect(screen.queryByTestId('overlap-confirm-dialog')).toBeNull();
  });

  it('mostra "Reconectar para ver títulos" só quando a conexão do closer pede', () => {
    renderGrid();
    expect(screen.queryByTestId('reconnect-for-titles')).toBeNull();
  });

  it('indicador de reconexão aparece sem botão de OAuth no cockpit', () => {
    renderGrid({ needsReconnectForTitles: true });
    expect(screen.getByTestId('reconnect-for-titles').textContent).toContain('Reconectar para ver títulos');
    expect(screen.queryByRole('button', { name: /Conectar com Google/ })).toBeNull();
  });

  it('o texto de ajuda explica o que pode e o que não pode ser marcado, sem travessão', () => {
    renderGrid();
    const help = screen.getByText(/Ocupado no Google mostra o compromisso/);
    expect(help.textContent).toContain('Reunião já marcada no Enriquece, feriado e horário passado não podem');
    expect(help.textContent).not.toMatch(/[\u2014\u2013]/);
  });
});
