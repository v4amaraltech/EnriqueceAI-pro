import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CockpitViewer } from '../types';

import { CockpitShell } from './CockpitShell';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/cockpit',
  useSearchParams: () => new URLSearchParams(),
}));

const viewer: CockpitViewer = { viewerId: 'u1', orgId: 'o1', isManager: false, targetUserId: 'u1', targetName: 'Bia Lima', sdrOptions: [] };

describe('CockpitShell: item "Discador"', () => {
  it('sem as flags do motor: continua sendo o link para a Execução, idêntico a antes', () => {
    render(<CockpitShell viewer={viewer} tab="tarefas"><div /></CockpitShell>);
    const link = screen.getByRole('link', { name: 'Discador' });
    expect(link.getAttribute('href')).toBe('/atividades?tab=dialer');
    expect(screen.queryByTestId('tab-discador')).toBeNull();
  });

  it('com as flags do motor: vira a aba própria do Cockpit', () => {
    render(<CockpitShell viewer={viewer} tab="tarefas" dialerTabEnabled><div /></CockpitShell>);
    const link = screen.getByRole('link', { name: 'Discador' });
    expect(link.getAttribute('href')).toBe('/cockpit?tab=discador');
    expect(link.getAttribute('aria-current')).toBeNull();
  });

  it('na aba Discador o item fica marcado como atual', () => {
    render(<CockpitShell viewer={viewer} tab="discador" dialerTabEnabled><div /></CockpitShell>);
    expect(screen.getByRole('link', { name: 'Discador' }).getAttribute('aria-current')).toBe('page');
  });
});
