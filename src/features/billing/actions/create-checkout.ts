'use server';

import { redirect } from 'next/navigation';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { requireAuth } from '@/lib/auth/require-auth';
import { stripe } from '@/lib/stripe';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { getAppUrl } from '@/lib/utils/app-url';

export async function createCheckoutSession(
  planId: string,
  returnPath?: string,
): Promise<ActionResult<{ url: string }>> {
  const user = await requireAuth();
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
    customerId = customer.id;

    // Save customer ID (use service role to bypass RLS for this update)
    const serviceClient = createServiceRoleClient();
    await from(serviceClient, 'organizations')
      .update({ stripe_customer_id: customerId } as Record<string, unknown>)
      .eq('id', org.id);
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
