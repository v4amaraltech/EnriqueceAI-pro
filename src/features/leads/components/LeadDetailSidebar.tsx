'use client';

import type { TimelineEntry } from '@/features/cadences/cadences.contract';

import type { LeadEnrollmentData } from '../actions/fetch-lead-enrollment';
import type { LeadRow } from '../types';
import { LeadInfoPanel } from './LeadInfoPanel';
import { leadRowToInfoPanelData } from './lead-info-panel.utils';

interface LeadDetailSidebarProps {
  lead: LeadRow;
  enrollmentData: LeadEnrollmentData;
  timeline: TimelineEntry[];
}

export function LeadDetailSidebar({ lead, enrollmentData, timeline }: LeadDetailSidebarProps) {
  const { enrollment, enrollments, kpis } = enrollmentData;

  return (
    <LeadInfoPanel
      data={leadRowToInfoPanelData(lead)}
      enrollment={enrollment}
      enrollments={enrollments}
      timeline={timeline}
      kpis={kpis}
    />
  );
}
