'use server';

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export type JobTitleOption = { value: string; label: string };

const DEFAULT_OPTIONS: JobTitleOption[] = [
  { value: 'Proprietário', label: 'Proprietário' },
  { value: 'Sócio', label: 'Sócio' },
  { value: 'CEO/Diretor Executivo', label: 'CEO/Diretor Executivo' },
  { value: 'Diretor', label: 'Diretor' },
  { value: 'Gerente', label: 'Gerente' },
  { value: 'Supervisor', label: 'Supervisor' },
  { value: 'Coordenador', label: 'Coordenador' },
  { value: 'Analista', label: 'Analista' },
  { value: 'Assistente/Funcionário', label: 'Assistente/Funcionário' },
  { value: 'Decisor', label: 'Decisor' },
];

export async function getJobTitleOptions(): Promise<JobTitleOption[]> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return DEFAULT_OPTIONS;

  const { orgId, supabase } = auth.data;

  const { data } = (await from(supabase, 'standard_field_settings')
    .select('options')
    .eq('org_id', orgId)
    .eq('field_key', 'job_title')
    .single()) as { data: { options: string[] | null } | null; error: unknown };

  if (!data?.options || data.options.length === 0) {
    return DEFAULT_OPTIONS;
  }

  return data.options.map((label) => ({ value: label, label }));
}
