import { STANDARD_FIELDS } from '@/features/settings-prospecting/constants/standard-fields';
import type { StandardFieldSettingRow } from '@/features/settings-prospecting/actions/standard-field-settings';

/**
 * Single source of truth for "Sub-origem" (canal) select options.
 *
 * Resolution order:
 *   1. Org's standard_field_settings.options for field_key='canal' — what
 *      the manager configured in Settings → Campos. Wins whenever set.
 *   2. STANDARD_FIELDS.canal.defaultOptions — the seed list applied to
 *      every new org. Used while the org's settings load, or when the
 *      org never customized the field.
 *
 * Callers should pass the standardFieldSettings list whenever they have
 * it (server pages load it via listStandardFieldSettingsForMember()).
 * Passing null/undefined gracefully degrades to defaults.
 *
 * Replaces the hardcoded CANAL_OPTIONS list in lead.schemas.ts, which
 * had drifted out of sync with both the seed and the org's customization
 * (e.g. V4 Amaral had 'Institucional' in settings but never in the
 * hardcoded list; the hardcoded list had 'Recuperação' but settings
 * didn't). Different surfaces (CreateLeadDialog vs LeadInfoPanel) ended
 * up showing different lists to the same user.
 */
export function getCanalOptions(settings: StandardFieldSettingRow[] | null | undefined): string[] {
  const orgSetting = settings?.find((s) => s.field_key === 'canal');
  if (orgSetting?.options && orgSetting.options.length > 0) {
    return orgSetting.options;
  }
  const def = STANDARD_FIELDS.find((f) => f.key === 'canal');
  return def?.defaultOptions ?? [];
}
