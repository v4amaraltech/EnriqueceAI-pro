'use server';

import { redirect } from 'next/navigation';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { requireManager } from '@/lib/auth/require-manager';
import { stripe } from '@/lib/stripe';
import { from } from '@/lib/supabase/from';
import { getAppUrl } from '@/lib/utils/app-url';

export async function createPortalSession(): Promise<ActionResult<{ url: string }>> {
  // Billing é manager-only: o portal Stripe permite cancelar a assinatura e
  // trocar o cartão — um SDR não pode mexer na cobrança da org.
  await requireManager();
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Get Stripe customer ID
  const { data: org } = (await from(supabase, 'organizations')
    .select('stripe_customer_id')
    .eq('id', orgId)
    .single()) as { data: { stripe_customer_id: string | null } | null };

  if (!org?.stripe_customer_id) {
    return { success: false, error: 'Nenhuma assinatura ativa encontrada. Faça upgrade primeiro.' };
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${getAppUrl()}/settings/billing`,
  });

  redirect(session.url);
}
