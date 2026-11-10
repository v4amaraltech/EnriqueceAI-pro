import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CockpitLeadsData } from '../services/cockpit-leads.service';
import { LeadsTab } from './LeadsTab';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/cockpit',
  useSearchParams: () => new URLSearchParams('tab=leads&sdr=sdr-1&period=today&stage=entrada&q=acme&page=2'),
}));

const data: CockpitLeadsData = {
  rows: [],
  total: 3,
  page: 1,
  perPage: 10,
  stageCounts: { entrada: 3, sql: 1 },
};

describe('LeadsTab', () => {
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
});
