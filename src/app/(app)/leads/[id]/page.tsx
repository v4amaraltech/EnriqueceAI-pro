import { notFound } from 'next/navigation';

import { requireAuth } from '@/lib/auth/require-auth';

import { fetchLeadTimeline } from '@/features/cadences/actions/fetch-interactions';
import { fetchLead } from '@/features/leads/actions/fetch-lead';
import { fetchLeadEnrollment } from '@/features/leads/actions/fetch-lead-enrollment';
import { LeadDetailLayout } from '@/features/leads/components/LeadDetailLayout';

interface LeadDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  await requireAuth();

  const { id } = await params;
  const [leadResult, timelineResult, enrollmentResult] = await Promise.all([
    fetchLead(id),
    fetchLeadTimeline(id),
    fetchLeadEnrollment(id),
  ]);

  if (!leadResult.success) {
    notFound();
  }

  const timeline = timelineResult.success ? timelineResult.data : [];
  const enrollmentData = enrollmentResult.success
    ? enrollmentResult.data
    : { enrollment: null, steps: [], enrollments: [], kpis: { completed: 0, open: 0, conversations: 0 } };

  return (
    <LeadDetailLayout
      lead={leadResult.data}
      timeline={timeline}
      enrollmentData={enrollmentData}
    />
  );
}
