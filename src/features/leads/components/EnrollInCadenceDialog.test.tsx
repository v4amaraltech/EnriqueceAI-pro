import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  enrollLeads: vi.fn(),
  switchLeadsCadence: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: m.toast }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/features/cadences/actions/manage-cadences', () => ({
  enrollLeads: m.enrollLeads,
  switchLeadsCadence: m.switchLeadsCadence,
}));
vi.mock('../actions/fetch-active-cadences', () => ({
  fetchActiveCadences: vi.fn().mockResolvedValue({ success: true, data: [{ id: 'c1', name: 'Cadência B', total_steps: 3 }] }),
}));

import { EnrollInCadenceDialog } from './EnrollInCadenceDialog';

const skip = (id: string) => `Lead ${id}: já está na cadência "Cadência A"`;

async function enrollWith(data: { enrolled: number; errors: string[] }, leadIds = ['L1', 'L2']) {
  m.enrollLeads.mockResolvedValue({ success: true, data });
  render(<EnrollInCadenceDialog open onOpenChange={vi.fn()} leadIds={leadIds} />);
  await userEvent.click(await screen.findByText(/Cadência B/));
  await waitFor(() => expect(m.enrollLeads).toHaveBeenCalled());
}

describe('EnrollInCadenceDialog — aviso de pulados', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1 pulado e nenhum inscrito', async () => {
    await enrollWith({ enrolled: 0, errors: [skip('L1')] }, ['L1']);
    await waitFor(() =>
      expect(m.toast.error).toHaveBeenCalledWith('1 lead pulado: já está em outra cadência (Cadência A)'),
    );
  });

  it('vários pulados com alguns inscritos', async () => {
    await enrollWith({ enrolled: 1, errors: [skip('L1'), skip('L2')] }, ['L1', 'L2', 'L3']);
    await waitFor(() =>
      expect(m.toast.warning).toHaveBeenCalledWith('2 leads pulados: já estão em outra cadência (Cadência A)'),
    );
  });

  it('erro que não é de pulado mantém o toast atual', async () => {
    await enrollWith({ enrolled: 0, errors: ['Lead L1: não encontrado'] }, ['L1']);
    await waitFor(() => expect(m.toast.error).toHaveBeenCalledWith('Lead L1: não encontrado'));
  });
});
