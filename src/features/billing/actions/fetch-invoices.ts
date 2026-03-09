'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { stripe } from '@/lib/stripe';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface InvoiceItem {
  id: string;
  date: string;
  amountCents: number;
  status: 'paid' | 'open' | 'void' | 'uncollectible';
  pdfUrl: string | null;
}

export async function fetchInvoices(): Promise<ActionResult<InvoiceItem[]>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data: org } = (await from(supabase, 'organizations')
    .select('stripe_customer_id')
    .eq('id', member.org_id)
    .single()) as { data: { stripe_customer_id: string | null } | null };

  if (!org?.stripe_customer_id) {
    return { success: true, data: [] };
  }

  try {
    const invoices = await stripe.invoices.list({
      customer: org.stripe_customer_id,
      limit: 10,
    });

    const items: InvoiceItem[] = invoices.data.map((inv) => ({
      id: inv.id,
      date: new Date(inv.created * 1000).toISOString(),
      amountCents: inv.amount_paid,
      status: inv.status as InvoiceItem['status'],
      pdfUrl: inv.invoice_pdf ?? null,
    }));

    return { success: true, data: items };
  } catch {
    return { success: true, data: [] };
  }
}
