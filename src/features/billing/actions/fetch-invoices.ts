'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { stripe } from '@/lib/stripe';
import { from } from '@/lib/supabase/from';

export interface InvoiceItem {
  id: string;
  date: string;
  amountCents: number;
  status: 'paid' | 'open' | 'void' | 'uncollectible';
  pdfUrl: string | null;
}

export async function fetchInvoices(): Promise<ActionResult<InvoiceItem[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data: org } = (await from(supabase, 'organizations')
    .select('stripe_customer_id')
    .eq('id', orgId)
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
