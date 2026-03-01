import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GoalsData } from '../types';

const mockGetGoals = vi.fn();
const mockSaveGoals = vi.fn();

vi.mock('../actions/get-goals', () => ({
  getGoals: (...args: unknown[]) => mockGetGoals(...args),
}));

vi.mock('../actions/save-goals', () => ({
  saveGoals: (...args: unknown[]) => mockSaveGoals(...args),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { GoalsModal } from './GoalsModal';

const goalsData: GoalsData = {
  month: '2026-02',
  opportunityTarget: 50,
  conversionTarget: 25,
  userGoals: [
    { userId: 'u1', userName: 'alice', opportunityTarget: 20, previousTarget: 15 },
    { userId: 'u2', userName: 'bob', opportunityTarget: 30, previousTarget: null },
  ],
};

describe('GoalsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGoals.mockResolvedValue({ success: true, data: goalsData });
    mockSaveGoals.mockResolvedValue({ success: true, data: { saved: true } });
  });

  it('renders title with month name', async () => {
    render(<GoalsModal open month="2026-02" onOpenChange={vi.fn()} />);
    const titles = await screen.findAllByText('Metas Fevereiro');
    expect(titles.length).toBeGreaterThanOrEqual(1);
  });

  it('shows loading state initially', () => {
    mockGetGoals.mockReturnValue(new Promise(() => {})); // never resolves
    render(<GoalsModal open month="2026-02" onOpenChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Salvar metas' })).toBeDisabled();
  });

  it('displays org-level goal fields after loading', async () => {
    render(<GoalsModal open month="2026-02" onOpenChange={vi.fn()} />);
    const oppInput = await screen.findByLabelText('Meta de Oportunidades');
    expect(oppInput).toHaveValue(50);
    const convInput = screen.getByLabelText('Taxa de Conversão');
    expect(convInput).toHaveValue(25);
  });

  it('displays user goals with previous target reference', async () => {
    render(<GoalsModal open month="2026-02" onOpenChange={vi.fn()} />);
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    // Previous month value is displayed as plain number
    expect(screen.getByText('15')).toBeInTheDocument();
    // bob has no previous target, shows dash
    expect(screen.getByText('–')).toBeInTheDocument();
  });

  it('shows effort estimate', async () => {
    render(<GoalsModal open month="2026-02" onOpenChange={vi.fn()} />);
    await screen.findByText('alice');
    expect(screen.getByText(/finalizar/)).toBeInTheDocument();
    expect(screen.getByText(/diárias por vendedor/)).toBeInTheDocument();
  });

  it('calls saveGoals on submit', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<GoalsModal open month="2026-02" onOpenChange={onOpenChange} />);

    await screen.findByText('alice');
    await user.click(screen.getByRole('button', { name: 'Salvar metas' }));

    await waitFor(() => {
      expect(mockSaveGoals).toHaveBeenCalledWith({
        month: '2026-02',
        opportunityTarget: 50,
        conversionTarget: 25,
        userGoals: [
          { userId: 'u1', opportunityTarget: 20 },
          { userId: 'u2', opportunityTarget: 30 },
        ],
      });
    });
  });

  it('calls onOpenChange(false) when Fechar clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<GoalsModal open month="2026-02" onOpenChange={onOpenChange} />);

    await screen.findByText('alice');
    await user.click(screen.getByRole('button', { name: 'Fechar' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not render content when closed', () => {
    render(<GoalsModal open={false} month="2026-02" onOpenChange={vi.fn()} />);
    expect(screen.queryByText('Metas Fevereiro')).not.toBeInTheDocument();
  });

  it('shows vendedores section with count', async () => {
    render(<GoalsModal open month="2026-02" onOpenChange={vi.fn()} />);
    expect(await screen.findByText('Vendedores (2)')).toBeInTheDocument();
  });

  it('shows previous month column header', async () => {
    render(<GoalsModal open month="2026-02" onOpenChange={vi.fn()} />);
    await screen.findByText('alice');
    // Previous month of February is January
    expect(screen.getAllByText('janeiro').length).toBeGreaterThanOrEqual(1);
  });

  it('shows estimativa section title', async () => {
    render(<GoalsModal open month="2026-02" onOpenChange={vi.fn()} />);
    await screen.findByText('alice');
    expect(screen.getByText('Estimativa de esforço para atingir a meta')).toBeInTheDocument();
  });
});
