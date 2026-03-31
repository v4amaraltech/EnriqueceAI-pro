import { requireManager } from '@/lib/auth/require-manager';

import { fetchCloserFeedbacks } from '@/features/leads/actions/fetch-closer-feedbacks';
import { CloserFeedbackTable } from '@/features/leads/components/CloserFeedbackTable';
import { CloserPerformanceCards } from '@/features/leads/components/CloserPerformanceCards';
import { FeedbackDateFilter } from '@/features/leads/components/FeedbackDateFilter';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

export default async function CloserFeedbacksPage({ searchParams }: PageProps) {
  await requireManager();

  const params = await searchParams;
  const result = await fetchCloserFeedbacks(params.from, params.to);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Feedbacks dos Closers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acompanhe as avaliações das reuniões e a performance dos closers.
          </p>
        </div>
        <FeedbackDateFilter />
      </div>

      {result.success ? (
        <>
          <CloserPerformanceCards feedbacks={result.data} />
          <CloserFeedbackTable feedbacks={result.data} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{result.error}</p>
      )}
    </div>
  );
}
