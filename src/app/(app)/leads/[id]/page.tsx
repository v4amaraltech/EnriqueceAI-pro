import { notFound } from 'next/navigation';

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { requireAuth } from '@/lib/auth/require-auth';
import { isManager } from '@/lib/auth/require-manager';

import { fetchLeadTimeline } from '@/features/cadences/actions/fetch-interactions';
import { isLeadChannelChatEnabled } from '@/features/lead-channel-chat/flag';
import { fetchLead } from '@/features/leads/actions/fetch-lead';
import { fetchLeadEnrollment } from '@/features/leads/actions/fetch-lead-enrollment';
import { getJobTitleOptions } from '@/features/leads/actions/get-job-title-options';
import { getLeadSourceOptions } from '@/features/leads/actions/get-lead-source-options';
import { LeadDetailLayout } from '@/features/leads/components/LeadDetailLayout';
import { listVisibleCustomFields } from '@/features/settings-prospecting/actions/custom-fields-crud';
import { listStandardFieldSettingsForMember } from '@/features/settings-prospecting/actions/standard-field-settings';

interface LeadDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const user = await requireAuth();
  const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const senderName = (typeof meta.full_name === 'string' && meta.full_name.trim())
    || (typeof meta.name === 'string' && meta.name.trim())
    || 'você';

  const { id } = await params;
  const auth = await getAuthOrgIdResult();
  const channelChatEnabled = auth.success ? await isLeadChannelChatEnabled(auth.data.orgId) : false;

  const [leadResult, timelineResult, enrollmentResult, customFieldsResult, leadSourceOptions, jobTitleOptions, stdFieldsResult, managerFlag] = await Promise.all([
    fetchLead(id),
    fetchLeadTimeline(id),
    fetchLeadEnrollment(id),
    listVisibleCustomFields(),
    getLeadSourceOptions(),
    getJobTitleOptions(),
    listStandardFieldSettingsForMember(),
    isManager(),
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

  return (
    <LeadDetailLayout
      lead={leadResult.data}
      timeline={timeline}
      enrollmentData={enrollmentData}
      customFieldDefs={customFieldDefs}
      leadSourceOptions={leadSourceOptions}
      jobTitleOptions={jobTitleOptions}
      standardFieldSettings={standardFieldSettings}
      isManager={managerFlag}
      channelChatEnabled={channelChatEnabled}
      senderName={senderName}
    />
  );
}
