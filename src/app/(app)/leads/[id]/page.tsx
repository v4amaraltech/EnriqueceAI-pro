import { notFound } from 'next/navigation';

import { requireAuth } from '@/lib/auth/require-auth';

import { fetchLeadTimeline } from '@/features/cadences/actions/fetch-interactions';
import { fetchLead } from '@/features/leads/actions/fetch-lead';
import { fetchLeadEnrollment } from '@/features/leads/actions/fetch-lead-enrollment';
import { getJobTitleOptions } from '@/features/leads/actions/get-job-title-options';
import { getLeadSourceOptions } from '@/features/leads/actions/get-lead-source-options';
import { LeadDetailLayout } from '@/features/leads/components/LeadDetailLayout';
import { listVisibleCustomFields } from '@/features/settings-prospecting/actions/custom-fields-crud';
import { listCanalOptions } from '@/features/settings-prospecting/actions/canal-crud';
import { listStandardFieldSettingsForMember } from '@/features/settings-prospecting/actions/standard-field-settings';

interface LeadDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  await requireAuth();

  const { id } = await params;
  const [leadResult, timelineResult, enrollmentResult, customFieldsResult, leadSourceOptions, jobTitleOptions, stdFieldsResult, canalResult] = await Promise.all([
    fetchLead(id),
    fetchLeadTimeline(id),
    fetchLeadEnrollment(id),
    listVisibleCustomFields(),
    getLeadSourceOptions(),
    getJobTitleOptions(),
    listStandardFieldSettingsForMember(),
    listCanalOptions(),
  ]);

  if (!leadResult.success) {
    notFound();
  }

  const timeline = timelineResult.success ? timelineResult.data : [];
  const enrollmentData = enrollmentResult.success
    ? enrollmentResult.data
    : { enrollment: null, steps: [], enrollments: [], kpis: { completed: 0, open: 0, conversations: 0 } };
  const customFieldDefs = customFieldsResult.success ? customFieldsResult.data : [];
  const standardFieldSettings = stdFieldsResult.success ? stdFieldsResult.data : [];
  const canalOptions = canalResult.success ? canalResult.data.map((c) => c.name) : undefined;

  return (
    <LeadDetailLayout
      lead={leadResult.data}
      timeline={timeline}
      enrollmentData={enrollmentData}
      customFieldDefs={customFieldDefs}
      leadSourceOptions={leadSourceOptions}
      jobTitleOptions={jobTitleOptions}
      standardFieldSettings={standardFieldSettings}
      canalOptions={canalOptions}
    />
  );
}
