'use client';

import type { TimelineEntry } from '@/features/cadences/cadences.contract';
import type { CustomFieldRow } from '@/features/settings-prospecting/types/custom-field';
import type { StandardFieldSettingRow } from '@/features/settings-prospecting/actions/standard-field-settings';

import type { LeadEnrollmentData } from '../actions/fetch-lead-enrollment';
import type { LeadSourceOption } from '../actions/get-lead-source-options';
import type { LeadRow } from '../types';
import { LeadInfoPanel } from './LeadInfoPanel';
import { leadRowToInfoPanelData } from './lead-info-panel.utils';

interface LeadDetailSidebarProps {
  lead: LeadRow;
  enrollmentData: LeadEnrollmentData;
  timeline: TimelineEntry[];
  customFieldDefs?: CustomFieldRow[];
  leadSourceOptions?: LeadSourceOption[];
  standardFieldSettings?: StandardFieldSettingRow[];
}

export function LeadDetailSidebar({ lead, enrollmentData, timeline, customFieldDefs, leadSourceOptions, standardFieldSettings }: LeadDetailSidebarProps) {
  const { enrollment, enrollments, kpis } = enrollmentData;

  return (
    <LeadInfoPanel
      data={leadRowToInfoPanelData(lead)}
      enrollment={enrollment}
      enrollments={enrollments}
      timeline={timeline}
      kpis={kpis}
      customFieldDefs={customFieldDefs}
      leadSourceOptions={leadSourceOptions}
      standardFieldSettings={standardFieldSettings}
    />
  );
}
