import type { StandardFieldSettingRow } from '@/features/settings-prospecting/actions/standard-field-settings';
import { STANDARD_FIELDS } from '@/features/settings-prospecting/constants/standard-fields';
import type { CustomFieldRow } from '@/features/settings-prospecting/types/custom-field';

import type { LeadRow } from '../types';

export interface MissingRequiredField {
  key: string;
  label: string;
  fieldType: 'text' | 'textarea' | 'number' | 'currency' | 'date' | 'datetime' | 'select';
  options?: string[];
  isCustom: boolean;
}

type Trigger = 'won' | 'lost';

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}

export function getMissingRequiredFields(
  lead: LeadRow,
  customFieldDefs: CustomFieldRow[],
  standardFieldSettings: StandardFieldSettingRow[],
  trigger: Trigger,
): MissingRequiredField[] {
  const missing: MissingRequiredField[] = [];
  const requiredKey = trigger === 'won' ? 'is_required_won' : 'is_required_lost';

  // Standard fields
  for (const setting of standardFieldSettings) {
    if (!setting[requiredKey]) continue;

    const value = lead[setting.field_key as keyof LeadRow];
    if (!isEmptyValue(value)) continue;

    const def = STANDARD_FIELDS.find((f) => f.key === setting.field_key);
    if (!def) continue;

    missing.push({
      key: setting.field_key,
      label: def.label,
      fieldType: def.type,
      isCustom: false,
    });
  }

  // Custom fields
  for (const cf of customFieldDefs) {
    if (!cf[requiredKey]) continue;

    const value = lead.custom_field_values?.[cf.id];
    if (!isEmptyValue(value)) continue;

    missing.push({
      key: cf.id,
      label: cf.field_name,
      fieldType: cf.field_type,
      options: cf.options ?? undefined,
      isCustom: true,
    });
  }

  return missing;
}
