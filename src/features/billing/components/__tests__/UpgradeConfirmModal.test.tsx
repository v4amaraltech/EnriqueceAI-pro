import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PlanRow } from '../../types';

import { UpgradeConfirmModal } from '../UpgradeConfirmModal';

vi.mock('../../actions/create-checkout', () => ({
  createCheckoutSession: vi.fn().mockResolvedValue({ success: true }),
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
    id: 'plan-1',
    name: 'Starter',
    slug: 'starter',
    price_cents: 14900,
    max_leads: 1000,
    max_ai_per_day: 30,
    max_whatsapp_per_month: 500,
    included_users: 2,
    additional_user_price_cents: 4900,
    features: { enrichment: 'basic', crm: false, calendar: false },
    active: true,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    ...overrides,
  };
}

const currentPlan = makePlan();
const targetPlan = makePlan({
  id: 'plan-2',
  name: 'Pro',
  slug: 'pro',
  price_cents: 34900,
  max_leads: 5000,
  max_ai_per_day: 100,
  max_whatsapp_per_month: 2000,
  included_users: 5,
  features: { enrichment: 'lemit', crm: true, calendar: true },
});

describe('UpgradeConfirmModal', () => {
  it('renders dialog with plan names', () => {
    render(
      <UpgradeConfirmModal
        open
        onOpenChange={() => {}}
        currentPlan={currentPlan}
        targetPlan={targetPlan}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Confirmar upgrade' })).toBeInTheDocument();
    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  it('renders price comparison', () => {
    render(
      <UpgradeConfirmModal
        open
        onOpenChange={() => {}}
        currentPlan={currentPlan}
        targetPlan={targetPlan}
      />,
    );

    expect(screen.getByText('R$ 149,00/mês')).toBeInTheDocument();
    expect(screen.getByText('R$ 349,00/mês')).toBeInTheDocument();
  });

  it('shows gained features', () => {
    render(
      <UpgradeConfirmModal
        open
        onOpenChange={() => {}}
        currentPlan={currentPlan}
        targetPlan={targetPlan}
      />,
    );

    expect(screen.getByText('Novas funcionalidades:')).toBeInTheDocument();
    expect(screen.getByText('CRM')).toBeInTheDocument();
    expect(screen.getByText('Calendário')).toBeInTheDocument();
  });

  it('shows limit changes', () => {
    render(
      <UpgradeConfirmModal
        open
        onOpenChange={() => {}}
        currentPlan={currentPlan}
        targetPlan={targetPlan}
      />,
    );

    expect(screen.getByText('Limites ampliados:')).toBeInTheDocument();
  });

  it('calls createCheckoutSession on confirm', async () => {
    const { createCheckoutSession } = await import('../../actions/create-checkout');
    const user = userEvent.setup();

    render(
      <UpgradeConfirmModal
        open
        onOpenChange={() => {}}
        currentPlan={currentPlan}
        targetPlan={targetPlan}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Confirmar upgrade' }));

    expect(createCheckoutSession).toHaveBeenCalledWith('plan-2');
  });

  it('calls onOpenChange when cancel is clicked', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <UpgradeConfirmModal
        open
        onOpenChange={onOpenChange}
        currentPlan={currentPlan}
        targetPlan={targetPlan}
      />,
    );

    await user.click(screen.getByText('Cancelar'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
