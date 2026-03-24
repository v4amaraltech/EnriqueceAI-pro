'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { stripe } from '@/lib/stripe';
import { from } from '@/lib/supabase/from';

export interface PaymentMethodInfo {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export async function fetchPaymentMethod(): Promise<ActionResult<PaymentMethodInfo | null>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data: org } = (await from(supabase, 'organizations')
    .select('stripe_customer_id')
    .eq('id', orgId)
    .single()) as { data: { stripe_customer_id: string | null } | null };

  if (!org?.stripe_customer_id) {
    return { success: true, data: null };
  }

  try {
    const customer = await stripe.customers.retrieve(org.stripe_customer_id, {
      expand: ['invoice_settings.default_payment_method'],
    });

    if (customer.deleted) {
      return { success: true, data: null };
    }

    const pm = customer.invoice_settings?.default_payment_method;
    if (!pm || typeof pm === 'string') {
      // Try to get from payment methods list
      const methods = await stripe.paymentMethods.list({
        customer: org.stripe_customer_id,
        type: 'card',
        limit: 1,
      });

      const card = methods.data[0]?.card;
      if (!card) {
        return { success: true, data: null };
      }

      return {
        success: true,
        data: {
          brand: card.brand,
          last4: card.last4,
          expMonth: card.exp_month,
          expYear: card.exp_year,
        },
      };
    }

    const card = pm.card;
    if (!card) {
      return { success: true, data: null };
    }

    return {
      success: true,
      data: {
        brand: card.brand,
        last4: card.last4,
        expMonth: card.exp_month,
        expYear: card.exp_year,
      },
    };
  } catch {
    return { success: true, data: null };
  }
}
