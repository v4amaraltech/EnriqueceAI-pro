import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/dashboard'),
}));

import { MobileNav } from './MobileNav';

describe('MobileNav', () => {
  it('renders hamburger button', () => {
    render(<MobileNav />);
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });

  it('opens drawer with logo on hamburger click', async () => {
    const user = userEvent.setup();
    render(<MobileNav />);

    await user.click(screen.getByRole('button', { name: 'Menu' }));

    expect(await screen.findByText('Enriquece AI')).toBeInTheDocument();
  });

  it('shows nav items in drawer', async () => {
    const user = userEvent.setup();
    render(<MobileNav />);

    await user.click(screen.getByRole('button', { name: 'Menu' }));

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Prospecção')).toBeInTheDocument();
    expect(screen.getByText('Ligações')).toBeInTheDocument();
    expect(screen.getByText('Estatísticas')).toBeInTheDocument();
  });

  it('expands Prospecção section to show submenu items', async () => {
    const user = userEvent.setup();
    render(<MobileNav />);

    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(await screen.findByText('Prospecção'));

    expect(await screen.findByText('Execução')).toBeInTheDocument();
    expect(screen.getByText('Cadências')).toBeInTheDocument();
    expect(screen.getByText('Leads')).toBeInTheDocument();
    expect(screen.getByText('Ajustes')).toBeInTheDocument();
  });

  it('shows Ligações items with all 4 active links', async () => {
    const user = userEvent.setup();
    render(<MobileNav />);

    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(await screen.findByText('Ligações'));

    expect(await screen.findByText('Painel')).toBeInTheDocument();
    expect(screen.getByText('Extrato')).toBeInTheDocument();

    // "Ligações" appears as both the section header and a submenu item
    const allLigacoes = screen.getAllByText('Ligações');
    expect(allLigacoes.length).toBeGreaterThanOrEqual(2);

    // Ajustes appears in both Prospecção and Ligações sections
    const allAjustes = screen.getAllByText('Ajustes');
    expect(allAjustes.length).toBeGreaterThanOrEqual(1);
  });

  it('shows Estatísticas items with active links', async () => {
    const user = userEvent.setup();
    render(<MobileNav />);

    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(await screen.findByText('Estatísticas'));

    expect(await screen.findByText('Ligação')).toBeInTheDocument();
    // "Prospecção" appears twice: as top-level section and as Estatísticas sub-item
    expect(screen.getAllByText('Prospecção').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Feedback de Oportunidade')).toBeInTheDocument();
    expect(screen.getByText('Equipe')).toBeInTheDocument();
  });

});
