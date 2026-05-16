'use server';

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { STANDARD_FIELDS } from '@/features/settings-prospecting/constants/standard-fields';

export type JobTitleOption = { value: string; label: string };

function defaultOptions(): JobTitleOption[] {
  const def = STANDARD_FIELDS.find((f) => f.key === 'job_title');
  return (def?.defaultOptions ?? []).map((label) => ({ value: label, label }));
}

export async function getJobTitleOptions(): Promise<JobTitleOption[]> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return defaultOptions();

  const { orgId, supabase } = auth.data;

  const { data } = (await from(supabase, 'standard_field_settings')
    .select('options')
    .eq('org_id', orgId)
    .eq('field_key', 'job_title')
    .single()) as { data: { options: string[] | null } | null; error: unknown };

  if (!data?.options || data.options.length === 0) return defaultOptions();
  return data.options.map((label) => ({ value: label, label }));
}
