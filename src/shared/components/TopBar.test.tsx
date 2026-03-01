import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/dashboard'),
}));

vi.mock('@/features/auth/components/UserMenu', () => ({
  UserMenu: () => <div data-testid="user-menu">UserMenu</div>,
}));

vi.mock('@/features/notifications/components/NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell">NotificationBell</div>,
}));

vi.mock('./ThemeToggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle">ThemeToggle</div>,
}));

vi.mock('./MobileNav', () => ({
  MobileNav: () => <div data-testid="mobile-nav">MobileNav</div>,
}));

vi.mock('./HelpCenter/HelpCenter', () => ({
  HelpCenter: () => <button data-testid="help-center" aria-label="Ajuda">Help</button>,
}));

import { TopBar, navSections } from './TopBar';

describe('TopBar', () => {
  it('renders logo with link to dashboard', () => {
    render(<TopBar />);
    const logo = screen.getByText('Enriquece AI');
    expect(logo).toBeInTheDocument();
    expect(logo.closest('a')).toHaveAttribute('href', '/dashboard');
  });

  it('renders Dashboard link', () => {
    render(<TopBar />);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });

  it('renders Prospecção dropdown trigger', () => {
    render(<TopBar />);
    expect(screen.getByText('Prospecção')).toBeInTheDocument();
  });

  it('renders Ligações dropdown trigger', () => {
    render(<TopBar />);
    expect(screen.getByText('Ligações')).toBeInTheDocument();
  });

  it('renders Estatísticas dropdown trigger', () => {
    render(<TopBar />);
    expect(screen.getByText('Estatísticas')).toBeInTheDocument();
  });

  it('renders right area with notifications, help, theme and user menu', () => {
    render(<TopBar />);
    expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
    expect(screen.getByTestId('user-menu')).toBeInTheDocument();
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('help-center')).toBeInTheDocument();
  });

  it('renders MobileNav component', () => {
    render(<TopBar />);
    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument();
  });

  it('opens Prospecção dropdown with correct submenu items', async () => {
    const user = userEvent.setup();
    render(<TopBar />);

    await user.click(screen.getByText('Prospecção'));

    expect(await screen.findByText('Execução')).toBeInTheDocument();
    expect(screen.getByText('Cadências')).toBeInTheDocument();
    expect(screen.getByText('Leads')).toBeInTheDocument();
    expect(screen.getByText('Ajustes')).toBeInTheDocument();
  });

  it('shows Ligações dropdown with all 4 active links', async () => {
    const user = userEvent.setup();
    render(<TopBar />);

    await user.click(screen.getByText('Ligações'));

    expect(await screen.findByText('Lista de Ligações')).toBeInTheDocument();
    expect(screen.getByText('Painel de Ligações')).toBeInTheDocument();

    // Extrato and Ajustes are links to their routes (inside Ligações dropdown)
    const extratoLink = screen.getByRole('menuitem', { name: 'Extrato' });
    expect(extratoLink).toBeInTheDocument();
    expect(extratoLink.closest('a')).toHaveAttribute('href', '/calls/extrato');

    // Ajustes appears in both Prospecção and Ligações; find the one linking to /calls/ajustes
    const allAjustes = screen.getAllByRole('menuitem', { name: 'Ajustes' });
    const callAjustes = allAjustes.find(
      (el) => el.closest('a')?.getAttribute('href') === '/calls/ajustes',
    );
    expect(callAjustes).toBeDefined();
  });

  it('exports navSections with 4 sections aligned to Meetime', () => {
    expect(navSections).toHaveLength(4);
    expect(navSections[0]?.label).toBe('Dashboard');
    expect(navSections[1]?.label).toBe('Prospecção');
    expect(navSections[1]?.items).toHaveLength(6);
    expect(navSections[2]?.label).toBe('Ligações');
    expect(navSections[2]?.items).toHaveLength(4);
    expect(navSections[3]?.label).toBe('Estatísticas');
    expect(navSections[3]?.items).toHaveLength(4);
  });
});
