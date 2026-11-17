import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MarkLeadLostDialog } from './MarkLeadLostDialog';

vi.mock('../actions/lead-lifecycle', () => ({
  fetchLossReasons: vi.fn(async () => ({ success: true, data: [] })),
  markLeadAsLost: vi.fn(),
  scheduleNewProspection: vi.fn(),
}));
vi.mock('../actions/fetch-active-cadences', () => ({ fetchActiveCadences: vi.fn(async () => ({ success: true, data: [] })) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('MarkLeadLostDialog: título', () => {
  it('sem props mantém "Desqualificar lead" e nenhuma descrição extra', () => {
    render(<MarkLeadLostDialog leadId="l1" open onOpenChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Desqualificar lead' })).toBeTruthy();
    expect(screen.queryByText('O lead já está perdido: escolha o novo motivo.')).toBeNull();
  });

  it('com title e description mostra os novos textos', () => {
    render(
      <MarkLeadLostDialog leadId="l1" open onOpenChange={vi.fn()} title="Mudar motivo de perda" description="O lead já está perdido: escolha o novo motivo." />,
    );
    expect(screen.getByRole('heading', { name: 'Mudar motivo de perda' })).toBeTruthy();
    expect(screen.getByText('O lead já está perdido: escolha o novo motivo.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Desqualificar lead' })).toBeNull();
  });
});
