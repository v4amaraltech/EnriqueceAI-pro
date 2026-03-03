import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PlanRow } from '../../types';

import { DowngradeConfirmModal } from '../DowngradeConfirmModal';

vi.mock('../../actions/create-checkout', () => ({
  createCheckoutSession: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../actions/fetch-downgrade-warnings', () => ({
  fetchDowngradeWarnings: vi
    .fn()
    .mockResolvedValue({ success: true, data: { warnings: [] } }),
}));

vi.mock('../../services/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/feature-flags')>();
  return {
    ...actual,
    formatCents: vi.fn((cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`),
  };
});

function makePlan(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: 'plan-2',
    name: 'Pro',
    slug: 'pro',
    price_cents: 34900,
    max_leads: 5000,
    max_ai_per_day: 100,
    max_whatsapp_per_month: 2000,
    included_users: 5,
    additional_user_price_cents: 8900,
    features: { enrichment: 'lemit', crm: true, calendar: true },
    active: true,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    ...overrides,
  };
}

const currentPlan = makePlan();
const targetPlan = makePlan({
  id: 'plan-1',
  name: 'Starter',
  slug: 'starter',
  price_cents: 14900,
  max_leads: 1000,
  max_ai_per_day: 30,
  max_whatsapp_per_month: 500,
  included_users: 2,
  features: { enrichment: 'basic', crm: false, calendar: false },
});

describe('DowngradeConfirmModal', () => {
  it('renders dialog with plan names', async () => {
    render(
      <DowngradeConfirmModal
        open
        onOpenChange={() => {}}
        currentPlan={currentPlan}
        targetPlan={targetPlan}
      />,
    );

    // Wait for useEffect to finish (fetches warnings)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Confirmar downgrade' })).toBeInTheDocument();
    });
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Starter')).toBeInTheDocument();
  });

  it('renders price comparison', async () => {
    render(
      <DowngradeConfirmModal
        open
        onOpenChange={() => {}}
        currentPlan={currentPlan}
        targetPlan={targetPlan}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('R$ 349,00/mês')).toBeInTheDocument();
    });
    expect(screen.getByText('R$ 149,00/mês')).toBeInTheDocument();
  });

  it('shows lost features', async () => {
    render(
      <DowngradeConfirmModal
        open
        onOpenChange={() => {}}
        currentPlan={currentPlan}
        targetPlan={targetPlan}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Funcionalidades perdidas:')).toBeInTheDocument();
    });
    expect(screen.getByText('CRM')).toBeInTheDocument();
    expect(screen.getByText('Calendário')).toBeInTheDocument();
  });

  it('shows limit reductions', async () => {
    render(
      <DowngradeConfirmModal
        open
        onOpenChange={() => {}}
        currentPlan={currentPlan}
        targetPlan={targetPlan}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Limites reduzidos:')).toBeInTheDocument();
    });
  });

  it('fetches and displays downgrade warnings', async () => {
    const { fetchDowngradeWarnings } = await import('../../actions/fetch-downgrade-warnings');
    vi.mocked(fetchDowngradeWarnings).mockResolvedValue({
      success: true,
      data: { warnings: ['Você tem 3.000 leads, mas o plano Starter permite apenas 1.000.'] },
    });

    render(
      <DowngradeConfirmModal
        open
        onOpenChange={() => {}}
        currentPlan={currentPlan}
        targetPlan={targetPlan}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Você tem 3.000 leads/)).toBeInTheDocument();
    });
  });

  it('calls createCheckoutSession on confirm', async () => {
    const { createCheckoutSession } = await import('../../actions/create-checkout');
    const user = userEvent.setup();

    render(
      <DowngradeConfirmModal
        open
        onOpenChange={() => {}}
        currentPlan={currentPlan}
        targetPlan={targetPlan}
      />,
    );

    // Wait for the component to settle after useEffect
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirmar downgrade' })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: 'Confirmar downgrade' }));

    expect(createCheckoutSession).toHaveBeenCalledWith('plan-1');
  });

  it('calls onOpenChange when cancel is clicked', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <DowngradeConfirmModal
        open
        onOpenChange={onOpenChange}
        currentPlan={currentPlan}
        targetPlan={targetPlan}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
