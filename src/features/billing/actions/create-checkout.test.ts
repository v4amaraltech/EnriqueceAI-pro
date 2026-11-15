import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sessionsCreate, redirectMock, fromMock } = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
  redirectMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: redirectMock }));

vi.mock('@/lib/auth/require-manager', () => ({
  requireManager: vi.fn(() => Promise.resolve({ id: 'user-1', email: 'gestor@test.com' })),
}));

vi.mock('@/lib/auth/get-org-id', () => ({
  getAuthOrgIdResult: vi.fn(() =>
    Promise.resolve({ success: true, data: { orgId: 'org-1', supabase: {} } }),
  ),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: sessionsCreate } },
    customers: { create: vi.fn(), del: vi.fn() },
  },
}));

vi.mock('@/lib/supabase/from', () => ({ from: fromMock }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/lib/utils/app-url', () => ({ getAppUrl: () => 'https://app.test' }));

import { createCheckoutSession } from './create-checkout';

type Plan = {
  id: string;
  name: string;
  slug: string;
  price_cents: number;
  stripe_price_id: string | null;
};

const basePlan: Plan = {
  id: 'plan-1',
  name: 'Pro',
  slug: 'pro',
  price_cents: 34900,
  stripe_price_id: null,
};

const org = { id: 'org-1', name: 'Org Teste', stripe_customer_id: 'cus_existente' };

/** Faz `from(supabase, tabela)` devolver uma cadeia select/eq/single com o dado da tabela. */
function mockTables(tables: { plans: Plan | null; organizations: typeof org | null }) {
  fromMock.mockImplementation((_client: unknown, table: 'plans' | 'organizations') => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      single: () => Promise.resolve({ data: tables[table] }),
    };
    return chain;
  });
}

describe('createCheckoutSession — line item', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/sessao' });
  });

  it('usa o Price do catálogo quando o plano tem stripe_price_id', async () => {
    mockTables({ plans: { ...basePlan, stripe_price_id: 'price_catalogo_123' }, organizations: org });

    await createCheckoutSession('plan-1');

    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    const params = sessionsCreate.mock.calls[0]![0];
    expect(params.line_items).toEqual([{ price: 'price_catalogo_123', quantity: 1 }]);
    expect(params.line_items[0]).not.toHaveProperty('price_data');
  });

  it('cai no price_data inline quando o plano não tem stripe_price_id', async () => {
    mockTables({ plans: basePlan, organizations: org });

    await createCheckoutSession('plan-1');

    const params = sessionsCreate.mock.calls[0]![0];
    expect(params.line_items).toEqual([
      {
        price_data: {
          currency: 'brl',
          product_data: {
            name: 'Enriquece AI Pro',
            description: 'Plano Pro — Enriquece AI',
          },
          unit_amount: 34900,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      },
    ]);
    expect(params.line_items[0]).not.toHaveProperty('price');
  });

  it('trata stripe_price_id vazio como ausente (usa o inline)', async () => {
    mockTables({ plans: { ...basePlan, stripe_price_id: '' }, organizations: org });

    await createCheckoutSession('plan-1');

    const params = sessionsCreate.mock.calls[0]![0];
    expect(params.line_items[0]).toHaveProperty('price_data');
  });

  it('mantém org e plano no metadata da sessão e da assinatura nos dois caminhos', async () => {
    for (const stripePriceId of ['price_catalogo_123', null]) {
      sessionsCreate.mockClear();
      mockTables({ plans: { ...basePlan, stripe_price_id: stripePriceId }, organizations: org });

      await createCheckoutSession('plan-1');

      const params = sessionsCreate.mock.calls[0]![0];
      expect(params.customer).toBe('cus_existente');
      expect(params.mode).toBe('subscription');
      expect(params.metadata).toEqual({ org_id: 'org-1', plan_id: 'plan-1' });
      expect(params.subscription_data.metadata).toEqual({ org_id: 'org-1', plan_id: 'plan-1' });
    }
  });

  it('redireciona para a URL da sessão criada', async () => {
    mockTables({ plans: basePlan, organizations: org });

    await createCheckoutSession('plan-1');

    expect(redirectMock).toHaveBeenCalledWith('https://checkout.stripe.test/sessao');
  });

  it('retorna erro e não chama a Stripe quando o plano não existe', async () => {
    mockTables({ plans: null, organizations: org });

    const result = await createCheckoutSession('plan-inexistente');

    expect(result).toEqual({ success: false, error: 'Plano não encontrado' });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});
