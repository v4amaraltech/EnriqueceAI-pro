import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { LeadFilters } from './LeadFilters';

const mockPush = vi.fn();
let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  useSearchParams: () => currentParams,
}));

// Radix Select usa pointer capture + scrollIntoView, que o jsdom não tem.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  mockPush.mockClear();
  currentParams = new URLSearchParams();
});

async function pickCreatedPeriod(option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Criado em' }));
  const listbox = await screen.findByRole('listbox');
  await user.click(within(listbox).getByRole('option', { name: option }));
  return user;
}

describe('LeadFilters — "Criado em"', () => {
  it('oferece os atalhos Hoje, Ontem, Últimos 7 dias, Este mês e Personalizado', async () => {
    const user = userEvent.setup();
    render(<LeadFilters />);
    await user.click(screen.getByRole('combobox', { name: 'Criado em' }));
    const listbox = await screen.findByRole('listbox');
    const labels = within(listbox).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['Todos', 'Hoje', 'Ontem', 'Últimos 7 dias', 'Este mês', 'Personalizado']);
  });

  it('"Hoje" vai para a URL como created_period=today (favorito continua certo amanhã)', async () => {
    render(<LeadFilters />);
    await pickCreatedPeriod('Hoje');
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/leads?created_period=today'));
  });

  it('"Personalizado" abre os campos de/até sem navegar; preencher "de" filtra por created_from', async () => {
    render(<LeadFilters />);
    const user = await pickCreatedPeriod('Personalizado');

    const from = screen.getByLabelText('Criado de');
    expect(screen.getByLabelText('Criado até')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();

    await user.type(from, '2026-09-01');
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/leads?created_from=2026-09-01'));
  });

  it('escolher um atalho limpa o período personalizado que estava na URL', async () => {
    currentParams = new URLSearchParams('created_from=2026-09-01&created_to=2026-09-10&status=new');
    render(<LeadFilters />);
    // Com de/até na URL o seletor mostra "Personalizado" e os campos aparecem
    expect(screen.getByLabelText('Criado de')).toHaveValue('2026-09-01');

    await pickCreatedPeriod('Ontem');
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    const url = new URL(mockPush.mock.calls[0]![0] as string, 'http://x');
    expect(url.searchParams.get('created_period')).toBe('yesterday');
    expect(url.searchParams.get('created_from')).toBeNull();
    expect(url.searchParams.get('created_to')).toBeNull();
    expect(url.searchParams.get('status')).toBe('new');
  });

  it('"Todos" remove o filtro e mantém os demais', async () => {
    currentParams = new URLSearchParams('created_period=today&assigned_to=11111111-2222-3333-4444-555555555555&page=3');
    render(<LeadFilters />);
    await pickCreatedPeriod('Todos');
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/leads?assigned_to=11111111-2222-3333-4444-555555555555'));
  });
});
