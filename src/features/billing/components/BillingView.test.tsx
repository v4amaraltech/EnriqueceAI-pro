import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { BillingOverview, PlanRow, SubscriptionRow } from '../types';

import { BillingView } from './BillingView';

vi.mock('../services/feature-flags', () => ({
  formatCents: vi.fn((cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`),
}));

vi.mock('../actions/create-portal', () => ({
  createPortalSession: vi.fn(),
}));

function makePlan(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: 'plan-1',
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

function makeSubscription(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 'sub-1',
    org_id: 'org-1',
    plan_id: 'plan-1',
    status: 'active',
    current_period_start: '2026-02-01T00:00:00Z',
    current_period_end: '2026-03-01T00:00:00Z',
    stripe_subscription_id: 'stripe-sub-1',
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    ...overrides,
  };
}

function makeBillingData(overrides: Partial<BillingOverview> = {}): BillingOverview {
  return {
    plan: makePlan(),
    subscription: makeSubscription(),
    memberCount: 3,
    additionalUsers: 0,
    monthlyTotal: 34900,
    aiUsageToday: { used: 20, limit: 100 },
    whatsappUsage: { used: 500, limit: 2000, period: '2026-02' },
    ...overrides,
  };
}

describe('BillingView', () => {
  describe('plan name and price', () => {
    it('renders plan name', () => {
      render(<BillingView data={makeBillingData()} />);

      expect(screen.getByText('Pro')).toBeInTheDocument();
    });

    it('renders plan price in formatted cents', () => {
      render(<BillingView data={makeBillingData()} />);

      expect(screen.getByText(/R\$ 349,00\/mês/)).toBeInTheDocument();
    });

    it('renders monthly total', () => {
      render(<BillingView data={makeBillingData({ monthlyTotal: 34900 })} />);

      expect(screen.getByText('R$ 349,00')).toBeInTheDocument();
    });
  });

  describe('subscription status badge', () => {
    it('renders active status badge', () => {
      render(<BillingView data={makeBillingData()} />);

      expect(screen.getByText('Ativa')).toBeInTheDocument();
    });

    it('renders trialing status badge', () => {
      const data = makeBillingData({
        subscription: makeSubscription({ status: 'trialing' }),
      });
      render(<BillingView data={data} />);

      expect(screen.getByText('Trial')).toBeInTheDocument();
    });

    it('renders past_due status badge', () => {
      const data = makeBillingData({
        subscription: makeSubscription({ status: 'past_due' }),
      });
      render(<BillingView data={data} />);

      expect(screen.getByText('Pagamento pendente')).toBeInTheDocument();
    });

    it('renders canceled status badge', () => {
      const data = makeBillingData({
        subscription: makeSubscription({ status: 'canceled' }),
      });
      render(<BillingView data={data} />);

      expect(screen.getByText('Cancelada')).toBeInTheDocument();
    });
  });

  describe('features list', () => {
    it('renders leads limit feature', () => {
      render(<BillingView data={makeBillingData()} />);

      expect(screen.getByText('Leads')).toBeInTheDocument();
      expect(screen.getByText('Até 5.000')).toBeInTheDocument();
    });

    it('renders enrichment feature level', () => {
      const data = makeBillingData({
        plan: makePlan({ features: { enrichment: 'lemit', crm: true, calendar: true } }),
      });
      render(<BillingView data={data} />);

      expect(screen.getByText('Enriquecimento')).toBeInTheDocument();
      expect(screen.getByText('Intermediário')).toBeInTheDocument();
    });

    it('renders full enrichment feature level', () => {
      const data = makeBillingData({
        plan: makePlan({ features: { enrichment: 'full', crm: true, calendar: true } }),
      });
      render(<BillingView data={data} />);

      expect(screen.getByText('Completo')).toBeInTheDocument();
    });

    it('renders basic enrichment feature level', () => {
      const data = makeBillingData({
        plan: makePlan({ features: { enrichment: 'basic', crm: false, calendar: false } }),
      });
      render(<BillingView data={data} />);

      expect(screen.getByText('Básico')).toBeInTheDocument();
    });

    it('renders CRM feature included', () => {
      render(<BillingView data={makeBillingData()} />);

      expect(screen.getByText('CRM')).toBeInTheDocument();
      expect(screen.getAllByText('Incluído').length).toBeGreaterThan(0);
    });

    it('renders calendar feature included', () => {
      render(<BillingView data={makeBillingData()} />);

      expect(screen.getByText('Calendário')).toBeInTheDocument();
    });

    it('renders WhatsApp per month feature', () => {
      render(<BillingView data={makeBillingData()} />);

      expect(screen.getByText('WhatsApp por mês')).toBeInTheDocument();
      expect(screen.getByText('2.000 mensagens')).toBeInTheDocument();
    });

    it('renders included users feature', () => {
      render(<BillingView data={makeBillingData()} />);

      expect(screen.getByText('Usuários inclusos')).toBeInTheDocument();
      expect(screen.getByText('5 usuários')).toBeInTheDocument();
    });
  });

  describe('unlimited AI', () => {
    it('shows Ilimitado in features list when max_ai_per_day is -1', () => {
      const data = makeBillingData({
        plan: makePlan({ max_ai_per_day: -1 }),
        aiUsageToday: { used: 42, limit: -1 },
      });
      render(<BillingView data={data} />);

      expect(screen.getByText('Ilimitado')).toBeInTheDocument();
    });
  });

  describe('additional users', () => {
    it('shows additional users info in price description when applicable', () => {
      const data = makeBillingData({
        additionalUsers: 2,
        plan: makePlan({ additional_user_price_cents: 8900 }),
      });
      render(<BillingView data={data} />);

      expect(screen.getByText(/2 usuários adicional/)).toBeInTheDocument();
    });

    it('shows singular form for one additional user', () => {
      const data = makeBillingData({
        additionalUsers: 1,
        plan: makePlan({ additional_user_price_cents: 8900 }),
      });
      render(<BillingView data={data} />);

      expect(screen.getByText(/1 usuário adicional/)).toBeInTheDocument();
    });

    it('does not show additional users price info when additionalUsers is 0', () => {
      const data = makeBillingData({ additionalUsers: 0 });
      render(<BillingView data={data} />);

      expect(screen.queryByText(/usuários? adicional/)).not.toBeInTheDocument();
    });
  });

  describe('subscription period', () => {
    it('renders current period dates', () => {
      render(<BillingView data={makeBillingData()} />);

      expect(screen.getByText('Período atual')).toBeInTheDocument();
    });

    it('renders member count', () => {
      render(<BillingView data={makeBillingData({ memberCount: 3 })} />);

      expect(screen.getByText('Membros')).toBeInTheDocument();
      expect(screen.getByText(/3 de 5 inclusos/)).toBeInTheDocument();
    });
  });
});
