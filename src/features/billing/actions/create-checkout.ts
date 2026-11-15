'use server';

import { redirect } from 'next/navigation';
import type Stripe from 'stripe';

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
    .select('id, name, slug, price_cents, stripe_price_id')
    .eq('id', planId)
    .single()) as {
    data: {
      id: string;
      name: string;
      slug: string;
      price_cents: number;
      stripe_price_id: string | null;
    } | null;
  };

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

  // Price do catálogo quando existir; senão, price_data inline.
  //
  // O inline cria um Product + Price NOVOS na Stripe a cada checkout, o que
  // suja o catálogo e inutiliza os relatórios por produto. Com o Price de
  // catálogo, o `price_id` também passa a resolver o plano no webhook sem
  // depender do metadata.
  //
  // O fallback não é temporário: cobre o plano Internal (sem cobrança) e
  // qualquer plano que ainda não tenha Price de catálogo gravado.
  //
  // Atenção: o fallback depende só de `stripe_price_id` estar nulo, não do
  // modo da chave. Um Price de produção gravado com a chave de teste faz o
  // `sessions.create` falhar com "No such price". Os Prices cadastrados
  // precisam ser recorrentes, mensais e em BRL (mode: 'subscription').
  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = plan.stripe_price_id
    ? { price: plan.stripe_price_id, quantity: 1 }
    : {
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
      };

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [lineItem],
    metadata: {
      org_id: org.id,
      plan_id: plan.id,
    },
    // O metadata da sessão só chega em `checkout.session.completed`. Repetindo
    // na subscription, TODO evento posterior (customer.subscription.*, e as
    // invoices via parent.subscription_details.metadata) já nasce carregando a
    // org — o webhook resolve qualquer um deles isoladamente, sem depender de
    // o `stripe_customer_id` já ter sido gravado. É a defesa contra eventos
    // fora de ordem, que a Stripe não garante.
    subscription_data: {
      metadata: {
        org_id: org.id,
        plan_id: plan.id,
      },
    },
    success_url: `${getAppUrl()}${returnPath && returnPath.startsWith('/') && !returnPath.includes('://') ? returnPath : '/settings/billing?success=true'}`,
    cancel_url: `${getAppUrl()}${returnPath && returnPath.startsWith('/') && !returnPath.includes('://') ? returnPath.split('?')[0] + '?canceled=true' : '/settings/billing?canceled=true'}`,
  });

  if (!session.url) {
    return { success: false, error: 'Erro ao criar sessão de pagamento' };
  }

  redirect(session.url);
}
