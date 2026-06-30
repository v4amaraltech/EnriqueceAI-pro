'use server';

import { redirect } from 'next/navigation';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { requireManager } from '@/lib/auth/require-manager';
import { stripe } from '@/lib/stripe';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { getAppUrl } from '@/lib/utils/app-url';

export async function createCheckoutSession(
  planId: string,
  returnPath?: string,
): Promise<ActionResult<{ url: string }>> {
  // Billing é manager-only: criar/alterar a assinatura é ação de gestor.
  const user = await requireManager();
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Get the plan to find its Stripe price
  const { data: plan } = (await from(supabase, 'plans')
    .select('id, name, slug, price_cents')
    .eq('id', planId)
    .single()) as { data: { id: string; name: string; slug: string; price_cents: number } | null };

  if (!plan) {
    return { success: false, error: 'Plano não encontrado' };
  }

  // Get or create Stripe customer
  const { data: org } = (await from(supabase, 'organizations')
    .select('id, name, stripe_customer_id')
    .eq('id', orgId)
    .single()) as { data: { id: string; name: string; stripe_customer_id: string | null } | null };

  if (!org) {
    return { success: false, error: 'Organização não encontrada' };
  }

  let customerId = org.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: org.name,
      metadata: { org_id: org.id },
    });

    // Conditional save — only persist this customer if no concurrent checkout
    // already wrote one. If we lose the race, drop our customer in Stripe and
    // use the winner's ID. Without this, two simultaneous "Assinar" clicks
    // create two Stripe customers and one becomes an orphan.
    const serviceClient = createServiceRoleClient();
    const { data: claimed } = (await from(serviceClient, 'organizations')
      .update({ stripe_customer_id: customer.id } as Record<string, unknown>)
      .eq('id', org.id)
      .is('stripe_customer_id', null)
      .select('stripe_customer_id')
      .maybeSingle()) as { data: { stripe_customer_id: string } | null };

    if (claimed?.stripe_customer_id) {
      customerId = claimed.stripe_customer_id;
    } else {
      // Lost the race — fetch the winner and delete our orphan customer.
      const { data: winner } = (await from(serviceClient, 'organizations')
        .select('stripe_customer_id')
        .eq('id', org.id)
        .single()) as { data: { stripe_customer_id: string | null } | null };
      customerId = winner?.stripe_customer_id ?? null;
      try {
        await stripe.customers.del(customer.id);
      } catch (err) {
        console.error('[create-checkout] Failed to delete orphan Stripe customer:', err);
      }
      if (!customerId) {
        return { success: false, error: 'Erro ao criar cliente Stripe' };
      }
    }
  }

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [
      {
        price_data: {
          currency: 'brl',
          product_data: {
            name: `Enriquece AI ${plan.name}`,
            description: `Plano ${plan.name} — Enriquece AI`,
          },
          unit_amount: plan.price_cents,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      },
    ],
    metadata: {
      org_id: org.id,
      plan_id: plan.id,
    },
    success_url: `${getAppUrl()}${returnPath && returnPath.startsWith('/') && !returnPath.includes('://') ? returnPath : '/settings/billing?success=true'}`,
    cancel_url: `${getAppUrl()}${returnPath && returnPath.startsWith('/') && !returnPath.includes('://') ? returnPath.split('?')[0] + '?canceled=true' : '/settings/billing?canceled=true'}`,
  });

  if (!session.url) {
    return { success: false, error: 'Erro ao criar sessão de pagamento' };
  }

  redirect(session.url);
}
