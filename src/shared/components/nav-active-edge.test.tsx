import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const path = vi.hoisted(() => ({ value: '/settings/prospecting/closers' }));

vi.mock('next/navigation', () => ({ usePathname: () => path.value }));
vi.mock('next/image', () => ({ default: (props: { alt: string }) => <img alt={props.alt} /> }));

import ProspectingSettingsLayout from '@/app/(app)/settings/prospecting/layout';

import { AppSidebar } from './AppSidebar';

describe('item ativo do menu', () => {
  it('marca Closers com uma borda primária de 2px e deixa os outros itens sem borda colorida', () => {
    render(
      <ProspectingSettingsLayout>
        <div>painel</div>
      </ProspectingSettingsLayout>,
    );
    expect(screen.getByRole('link', { name: 'Closers' }).className).toContain('border-l-primary');
    expect(screen.getByRole('link', { name: 'Fit Score' }).className).toContain('border-l-transparent');
  });

  it('marca o item ativo da barra lateral com a mesma borda, no tema claro e no escuro', () => {
    path.value = '/dashboard';
    render(
      <AppSidebar>
        <div>app</div>
      </AppSidebar>,
    );
    const dashboard = screen.getAllByRole('link', { name: 'Dashboard' }).at(0);
    const leads = screen.getAllByRole('link', { name: 'Leads' }).at(0);
    if (!dashboard || !leads) throw new Error('item do menu');
    expect(dashboard.className).toContain('border-l-2');
    expect(dashboard.className).toContain('border-l-primary');
    expect(leads.className).toContain('border-l-transparent');
  });
});
