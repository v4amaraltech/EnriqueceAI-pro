'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { StandardFieldSettingRow } from '@/features/settings-prospecting/actions/standard-field-settings';
import type { CustomFieldRow } from '@/features/settings-prospecting/types/custom-field';

import type { LeadRow } from '../types';
import { getMissingRequiredFields, type MissingRequiredField } from '../utils/required-field-validation';

/**
 * Returns the list of fields the manager marked as required for meeting
 * scheduling that are still empty on this lead. Used by the schedule
 * surfaces (LeadScheduleTab, ScheduleMeetingModal) to disable the
 * "Agendar" button and surface the missing fields inline.
 *
 * scheduleMeeting() runs the same check server-side; this action exists
 * only to drive the UI — never trust an empty result here as authorization.
 */
export async function getMissingMeetingFields(
  leadId: string,
): Promise<ActionResult<MissingRequiredField[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const [leadRes, cfRes, sfRes] = await Promise.all([
    from(supabase, 'leads').select('*').eq('id', leadId).eq('org_id', orgId).single() as Promise<{ data: LeadRow | null }>,
    from(supabase, 'custom_fields').select('*').eq('org_id', orgId) as Promise<{ data: CustomFieldRow[] | null }>,
    from(supabase, 'standard_field_settings').select('*').eq('org_id', orgId) as Promise<{ data: StandardFieldSettingRow[] | null }>,
  ]);

  if (!leadRes.data) return { success: false, error: 'Lead não encontrado' };

  const missing = getMissingRequiredFields(leadRes.data, cfRes.data ?? [], sfRes.data ?? [], 'meeting');
  return { success: true, data: missing };
}
