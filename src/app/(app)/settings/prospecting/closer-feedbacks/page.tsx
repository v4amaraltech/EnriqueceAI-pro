import { requireManager } from '@/lib/auth/require-manager';

import { fetchCloserFeedbacks } from '@/features/leads/actions/fetch-closer-feedbacks';
import { CloserFeedbackTable } from '@/features/leads/components/CloserFeedbackTable';

export default async function CloserFeedbacksPage() {
  await requireManager();

  const result = await fetchCloserFeedbacks();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Feedbacks dos Closers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Acompanhe as avaliações das reuniões enviadas pelos closers.
        </p>
      </div>

      {result.success ? (
        <CloserFeedbackTable feedbacks={result.data} />
      ) : (
        <p className="text-sm text-muted-foreground">{result.error}</p>
      )}
    </div>
  );
}
