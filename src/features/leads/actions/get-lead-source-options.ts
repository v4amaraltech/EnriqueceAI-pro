'use server';

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { LEAD_SOURCE_OPTIONS } from '../schemas/lead.schemas';

export type LeadSourceOption = { value: string; label: string };

const DEFAULT_OPTIONS: LeadSourceOption[] = LEAD_SOURCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

export async function getLeadSourceOptions(): Promise<LeadSourceOption[]> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return DEFAULT_OPTIONS;

  const { orgId, supabase } = auth.data;

  const { data } = (await (supabase as any)
    .from('standard_field_settings')
    .select('options')
    .eq('org_id', orgId)
    .eq('field_key', 'lead_source')
    .single()) as { data: { options: string[] | null } | null; error: unknown };

  if (!data?.options || data.options.length === 0) {
    return DEFAULT_OPTIONS;
  }

  return data.options.map((label) => ({ value: label, label }));
}
