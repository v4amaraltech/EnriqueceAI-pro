import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { UsageLimits } from '../services/feature-flags';
import type { AiDailyUsage, PlanRow, UsageDashboardData } from '../types';

import { UsageDashboard } from './UsageDashboard';

vi.mock('../services/feature-flags', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/feature-flags')>();
  return {
    ...mod,
    isNearLimit: vi.fn((current: number, max: number) => max > 0 && current / max >= 0.8),
  };
});

vi.mock('./AiUsageChart', () => ({
  AiUsageChart: ({ data, dailyLimit }: { data: AiDailyUsage[]; dailyLimit: number }) => (
    <div data-testid="ai-usage-chart" data-points={data.length} data-limit={dailyLimit} />
  ),
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

function makeLimits(overrides: Partial<UsageLimits> = {}): UsageLimits {
  return {
    leads: { current: 1200, max: 5000, exceeded: false },
    aiPerDay: { current: 20, max: 100, exceeded: false, unlimited: false },
    whatsappPerMonth: { current: 500, max: 2000, exceeded: false },
    users: { current: 3, included: 5, additional: 0 },
    ...overrides,
  };
}

function makeData(overrides: Partial<UsageDashboardData> = {}): UsageDashboardData {
  return {
    limits: makeLimits(),
    plan: makePlan(),
    aiHistory: [],
    ...overrides,
  };
}

describe('UsageDashboard', () => {
  describe('card labels', () => {
    it('renders all 4 usage cards', () => {
      render(<UsageDashboard data={makeData()} />);

      expect(screen.getByText('Leads')).toBeInTheDocument();
      expect(screen.getByText('IA (hoje)')).toBeInTheDocument();
      expect(screen.getByText('WhatsApp (mês)')).toBeInTheDocument();
      expect(screen.getByText('Membros')).toBeInTheDocument();
    });

    it('renders section title', () => {
      render(<UsageDashboard data={makeData()} />);

      expect(screen.getByText('Consumo')).toBeInTheDocument();
    });
  });

  describe('leads card', () => {
    it('shows leads current/max', () => {
      render(<UsageDashboard data={makeData()} />);

      expect(screen.getByText('1200 / 5000')).toBeInTheDocument();
    });
  });

  describe('AI card', () => {
    it('shows AI current/max', () => {
      render(<UsageDashboard data={makeData()} />);

      expect(screen.getByText('20 / 100')).toBeInTheDocument();
    });

    it('shows "ilimitado" when AI is unlimited', () => {
      const data = makeData({
        limits: makeLimits({
          aiPerDay: { current: 42, max: -1, exceeded: false, unlimited: true },
        }),
        plan: makePlan({ max_ai_per_day: -1 }),
      });
      render(<UsageDashboard data={data} />);

      expect(screen.getByText('42 (ilimitado)')).toBeInTheDocument();
    });
  });

  describe('WhatsApp card', () => {
    it('shows WhatsApp current/max', () => {
      render(<UsageDashboard data={makeData()} />);

      expect(screen.getByText('500 / 2000')).toBeInTheDocument();
    });
  });

  describe('members card', () => {
    it('shows members current/included', () => {
      render(<UsageDashboard data={makeData()} />);

      expect(screen.getByText('3 / 5')).toBeInTheDocument();
    });

    it('shows additional members overage label', () => {
      const data = makeData({
        limits: makeLimits({
          users: { current: 7, included: 5, additional: 2 },
        }),
      });
      render(<UsageDashboard data={data} />);

      expect(screen.getByText('(+2 adicional)')).toBeInTheDocument();
    });
  });

  describe('AI usage chart', () => {
    it('renders chart with ai history data', () => {
      const data = makeData({ aiHistory: [{ date: '2026-03-01', count: 10 }] });
      render(<UsageDashboard data={data} />);

      expect(screen.getByText('Uso de IA — Últimos 30 dias')).toBeInTheDocument();
      const chart = screen.getByTestId('ai-usage-chart');
      expect(chart).toHaveAttribute('data-points', '1');
      expect(chart).toHaveAttribute('data-limit', '100');
    });

    it('passes -1 limit for unlimited plans', () => {
      const data = makeData({
        plan: makePlan({ max_ai_per_day: -1 }),
        aiHistory: [],
      });
      render(<UsageDashboard data={data} />);

      const chart = screen.getByTestId('ai-usage-chart');
      expect(chart).toHaveAttribute('data-limit', '-1');
    });
  });

  describe('near limit indicators', () => {
    it('shows warning indicators when leads are above 80%', () => {
      const data = makeData({
        limits: makeLimits({
          leads: { current: 4500, max: 5000, exceeded: false },
        }),
      });
      render(<UsageDashboard data={data} />);

      expect(screen.getByText('4500 / 5000')).toBeInTheDocument();
    });

    it('shows exceeded state when at 100%', () => {
      const data = makeData({
        limits: makeLimits({
          leads: { current: 5000, max: 5000, exceeded: true },
        }),
      });
      render(<UsageDashboard data={data} />);

      expect(screen.getByText('5000 / 5000')).toBeInTheDocument();
    });
  });
});
