'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { AIService } from '@/features/ai/services/ai.service';
import { buildLeadContext } from '@/features/ai/utils/build-lead-context';
import { buildLeadTemplateVariables } from '@/features/cadences/utils/build-template-variables';
import { renderTemplate } from '@/features/cadences/utils/render-template';

import type { ActivityLead, PreparedEmail, PreparedWhatsApp } from '../types';
import { resolveWhatsAppPhone } from '../utils/resolve-whatsapp-phone';

interface PrepareInput {
  lead: ActivityLead;
  templateSubject: string | null;
  templateBody: string | null;
  aiPersonalization: boolean;
  channel: 'email' | 'whatsapp';
}

/**
 * Resolves the {{referencia}} variable from the org's custom field marked
 * with system_key='referencia'. V4 Amaral uses the "Qual Cliente Indicou"
 * field for the Recomendação channel — value is the name of the customer
 * who referred the lead.
 *
 * Returns null when the org has no system_key='referencia' field configured
 * or when this lead's custom_field_values doesn't carry it. renderTemplate
 * keeps {{referencia}} as-is in that case (matches the existing behavior for
 * unresolved variables, but avoids the bug of sending the literal token
 * to the recipient — the template author can spot it in preview).
 */
async function resolveReferenciaVariable(lead: ActivityLead): Promise<string | null> {
  if (!lead.custom_field_values) return null;
  try {
    const supabase = await createServerSupabaseClient();
    const { data: field } = (await from(supabase, 'custom_fields')
      .select('id')
      .eq('org_id', lead.org_id)
      .eq('system_key', 'referencia')
      .limit(1)
      .maybeSingle()) as { data: { id: string } | null };
    if (!field) return null;
    const value = lead.custom_field_values[field.id];
    return value && typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

async function resolveVendorVariables(userId: string): Promise<{ nome_vendedor: string | null; email_vendedor: string | null }> {
  try {
    const adminClient = createAdminSupabaseClient();
    const { data: vendorUser } = await adminClient.auth.admin.getUserById(userId);
    if (vendorUser?.user) {
      const meta = vendorUser.user.user_metadata as { full_name?: string } | undefined;
      return {
        nome_vendedor: meta?.full_name ?? null,
        email_vendedor: vendorUser.user.email ?? null,
      };
    }
  } catch {
    // Fallback: no vendor data
  }
  return { nome_vendedor: null, email_vendedor: null };
}

export async function prepareActivityEmail(
  input: PrepareInput,
): Promise<ActionResult<PreparedEmail>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { userId } = auth.data;

  const { lead, templateSubject, templateBody, aiPersonalization, channel } = input;

  // Resolve email: socios enriched emails (by ranking) → lead.email fallback
  const toEmail = (lead.socios ?? [])
    .flatMap((s) => s.emails ?? [])
    .sort((a, b) => a.ranking - b.ranking)[0]?.email
    ?? lead.email
    ?? '';

  if (!templateBody) {
    return {
      success: true,
      data: {
        to: toEmail,
        subject: templateSubject ?? '',
        body: '',
        aiPersonalized: false,
      },
    };
  }

  const [vendorVars, referencia] = await Promise.all([
    resolveVendorVariables(userId),
    resolveReferenciaVariable(lead),
  ]);
  const socioNome = (lead.socios ?? [])[0]?.nome ?? null;
  const variables: Record<string, string | null> = {
    ...buildLeadTemplateVariables(lead, socioNome),
    ...vendorVars,
    referencia,
  };

  let body = renderTemplate(templateBody, variables);
  let subject = templateSubject ? renderTemplate(templateSubject, variables) : '';
  let aiPersonalized = false;

  if (aiPersonalization && body) {
    try {
      const leadContext = buildLeadContext(lead);
      const aiResult = await AIService.personalizeMessage(
        channel,
        body,
        leadContext,
        lead.org_id,
      );
      body = aiResult.body;
      if (aiResult.subject) {
        subject = aiResult.subject;
      }
      aiPersonalized = true;
    } catch (aiError) {
      console.error('[activities] AI personalization failed, using template fallback:', aiError);
    }
  }

  return {
    success: true,
    data: {
      to: toEmail,
      subject,
      body,
      aiPersonalized,
    },
  };
}

export async function prepareActivityWhatsApp(
  input: PrepareInput,
): Promise<ActionResult<PreparedWhatsApp>> {
  const auth2 = await getAuthOrgIdResult();
  if (!auth2.success) return auth2;
  const { userId: userId2 } = auth2.data;

  const { lead, templateBody, aiPersonalization, channel } = input;

  const resolved = resolveWhatsAppPhone(lead);
  if (!resolved) {
    return { success: false, error: 'Lead sem telefone cadastrado' };
  }

  const phone = resolved.formatted;

  if (!templateBody) {
    return {
      success: true,
      data: {
        to: phone,
        body: '',
        aiPersonalized: false,
      },
    };
  }

  const [vendorVars, referencia] = await Promise.all([
    resolveVendorVariables(userId2),
    resolveReferenciaVariable(lead),
  ]);
  const socioNome = (lead.socios ?? [])[0]?.nome ?? null;
  const variables: Record<string, string | null> = {
    ...buildLeadTemplateVariables(lead, socioNome),
    ...vendorVars,
    referencia,
  };

  let body = renderTemplate(templateBody, variables);
  let aiPersonalized = false;

  if (aiPersonalization && body) {
    try {
      const leadContext = buildLeadContext(lead);
      const aiResult = await AIService.personalizeMessage(
        channel,
        body,
        leadContext,
        lead.org_id,
      );
      body = aiResult.body;
      aiPersonalized = true;
    } catch (aiError) {
      console.error('[activities] AI personalization failed, using template fallback:', aiError);
    }
  }

  return {
    success: true,
    data: {
      to: phone,
      body,
      aiPersonalized,
    },
  };
}
