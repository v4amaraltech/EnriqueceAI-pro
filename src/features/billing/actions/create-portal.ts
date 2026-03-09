'use server';

import { redirect } from 'next/navigation';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { stripe } from '@/lib/stripe';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function createPortalSession(): Promise<ActionResult<{ url: string }>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  // Get user's org
  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  // Get Stripe customer ID
  const { data: org } = (await from(supabase, 'organizations')
    .select('stripe_customer_id')
    .eq('id', member.org_id)
    .single()) as { data: { stripe_customer_id: string | null } | null };

  if (!org?.stripe_customer_id) {
    return { success: false, error: 'Nenhuma assinatura ativa encontrada. Faça upgrade primeiro.' };
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/settings/billing`,
  });

  redirect(session.url);
}
