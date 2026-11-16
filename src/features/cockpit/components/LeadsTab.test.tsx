import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CockpitLeadsData } from '../services/cockpit-leads.service';
import { LeadsTab } from './LeadsTab';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => '/cockpit',
  useSearchParams: () => new URLSearchParams('tab=leads&sdr=sdr-1&period=today&stage=entrada&q=acme&page=2'),
}));

const data: CockpitLeadsData = {
  rows: [],
  total: 3,
  page: 1,
  perPage: 25,
  stageCounts: { entrada: 3, sql: 1 },
};

const filters = { period: null, from: null, to: null, stage: null } as const;

describe('LeadsTab', () => {
  beforeEach(() => {
    nav.replace.mockClear();
    // jsdom não implementa o que o Select (Radix) usa.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('destaca o período e a etapa e o segundo clique limpa só a etapa', () => {
    render(<LeadsTab data={data} search="acme" filters={{ period: 'today', from: null, to: null, stage: 'entrada' }} />);

    expect(screen.getByRole('link', { name: 'Hoje' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('link', { name: 'Tudo' }).getAttribute('href')).toBe('/cockpit?tab=leads&sdr=sdr-1&stage=entrada&q=acme');
    const entrada = screen.getByTestId('stage-entrada');
    expect(entrada.getAttribute('aria-current')).toBe('true');
    expect(entrada.getAttribute('href')).toBe('/cockpit?tab=leads&sdr=sdr-1&period=today&q=acme');
    expect(screen.getByRole('link', { name: 'Limpar' }).getAttribute('href')).toBe('/cockpit?tab=leads&sdr=sdr-1&period=today&q=acme');
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
  });

  it('padrão 25: seletor mostra 25 e o texto "Mostrando" usa o tamanho', () => {
    render(<LeadsTab data={{ ...data, total: 165 }} search="" filters={filters} />);
    expect(screen.getByLabelText('Itens por página').textContent).toContain('25');
    expect(screen.getByText('Mostrando 1 a 25 de 165 resultados')).toBeTruthy();
    expect(screen.getByText('1 / 7')).toBeTruthy();
  });

  it('com 50 por página: texto e total de páginas acompanham', () => {
    render(<LeadsTab data={{ ...data, total: 165, perPage: 50, page: 2 }} search="" filters={filters} />);
    expect(screen.getByText('Mostrando 51 a 100 de 165 resultados')).toBeTruthy();
    expect(screen.getByText('2 / 4')).toBeTruthy();
  });

  it.each([
    ['50', 'per_page=50'],
    ['100', 'per_page=100'],
  ])('trocar para %s grava per_page na URL e volta à página 1', (opt, expected) => {
    render(<LeadsTab data={{ ...data, total: 165 }} search="" filters={filters} />);
    fireEvent.click(screen.getByLabelText('Itens por página'));
    fireEvent.click(screen.getByRole('option', { name: opt }));
    const href = String(nav.replace.mock.calls.at(-1)?.[0]);
    expect(href).toContain(expected);
    expect(href).not.toContain('page=2');
    expect(href).toMatch(/[?&]tab=leads/);
  });

  it('voltar para 25 remove per_page da URL', () => {
    render(<LeadsTab data={{ ...data, total: 165, perPage: 50 }} search="" filters={filters} />);
    fireEvent.click(screen.getByLabelText('Itens por página'));
    fireEvent.click(screen.getByRole('option', { name: '25' }));
    expect(String(nav.replace.mock.calls.at(-1)?.[0])).not.toContain('per_page');
  });
});
