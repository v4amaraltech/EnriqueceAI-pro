import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarkLeadLostDialog } from './MarkLeadLostDialog';

vi.mock('../actions/lead-lifecycle', () => ({
  fetchLossReasons: vi.fn(() => {
    throw new Error('o modal não pode usar a Server Action (fila)');
  }),
  markLeadAsLost: vi.fn(),
  scheduleNewProspection: vi.fn(),
}));
const options = vi.hoisted(() => ({
  fetchLossDialogOptions: vi.fn(),
  getCachedLossDialogOptions: vi.fn(),
}));
vi.mock('../fetch-loss-dialog-options', () => options);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const EMPTY = { lossReasons: { success: true, data: [] }, cadences: { success: true, data: [] } };

beforeEach(() => {
  options.fetchLossDialogOptions.mockReset().mockResolvedValue(EMPTY);
  options.getCachedLossDialogOptions.mockReset().mockReturnValue(null);
});

describe('MarkLeadLostDialog: lista de motivos', () => {
  it('busca pela rota GET e mostra "Carregando motivos…" até chegar', async () => {
    let resolve: (v: unknown) => void = () => {};
    options.fetchLossDialogOptions.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<MarkLeadLostDialog leadId="l1" open onOpenChange={vi.fn()} />);
    expect(screen.getByText('Carregando motivos…')).toBeTruthy();
    expect(options.fetchLossDialogOptions).toHaveBeenCalledTimes(1);
    resolve({
      lossReasons: { success: true, data: [{ id: 'r1', name: 'Não ICP' }] },
      cadences: { success: true, data: [] },
    });
    await waitFor(() => expect(screen.getByText('Selecione o motivo')).toBeTruthy());
  });

  it('com lista já carregada antes, abre pronto (sem "Carregando")', () => {
    options.fetchLossDialogOptions.mockReturnValue(new Promise(() => {}));
    options.getCachedLossDialogOptions.mockReturnValue({
      lossReasons: [{ id: 'r1', name: 'Não ICP' }],
      cadences: [],
    });
    render(<MarkLeadLostDialog leadId="l1" open onOpenChange={vi.fn()} />);
    expect(screen.queryByText('Carregando motivos…')).toBeNull();
    expect(screen.getByText('Selecione o motivo')).toBeTruthy();
  });
});

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
