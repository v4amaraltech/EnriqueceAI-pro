import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { FeedbackForm } from './FeedbackForm';

interface FeedbackRequest {
  id: string;
  token: string;
  result: string | null;
  responded_at: string | null;
  expires_at: string;
  closer_id: string;
  lead_id: string;
}

interface CloserInfo {
  name: string;
}

interface LeadInfo {
  nome_fantasia: string | null;
  razao_social: string | null;
}

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createServiceRoleClient();

  // Validate UUID format
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(token)) {
    return <ErrorPage message="Link inválido." />;
  }

  // Fetch feedback request
  const { data: request } = (await from(supabase, 'closer_feedback_requests')
    .select('id, token, result, responded_at, expires_at, closer_id, lead_id')
    .eq('token', token)
    .single()) as { data: FeedbackRequest | null };

  if (!request) {
    return <ErrorPage message="Link de feedback não encontrado." />;
  }

  // Check if already responded
  if (request.responded_at) {
    return <ErrorPage message="Este feedback já foi enviado. Obrigado!" />;
  }

  // Check if expired
  if (new Date(request.expires_at) < new Date()) {
    return <ErrorPage message="Este link de feedback expirou." />;
  }

  // Fetch closer and lead info for display
  const [closerResult, leadResult] = await Promise.all([
    from(supabase, 'closers')
      .select('name')
      .eq('id', request.closer_id)
      .single() as Promise<{ data: CloserInfo | null }>,
    from(supabase, 'leads')
      .select('nome_fantasia, razao_social')
      .eq('id', request.lead_id)
      .single() as Promise<{ data: LeadInfo | null }>,
  ]);

  const closerName = closerResult.data?.name ?? 'Closer';
  const leadName = leadResult.data?.nome_fantasia ?? leadResult.data?.razao_social ?? 'Lead';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[var(--background)] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="bg-white dark:bg-[var(--card)] rounded-xl shadow-sm border border-gray-200 dark:border-[var(--border)] overflow-hidden">
          <div className="bg-[#1a1a2e] px-8 py-6">
            <h1 className="text-white text-xl font-semibold">EnriqueceAI</h1>
            <p className="text-gray-300 text-sm mt-1">Feedback da Reunião</p>
          </div>
          <div className="p-8">
            <p className="text-gray-600 dark:text-[var(--muted-foreground)] mb-6">
              Olá, <strong>{closerName}</strong>! Como foi a reunião com <strong>{leadName}</strong>?
            </p>
            <FeedbackForm token={token} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[var(--background)] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="bg-white dark:bg-[var(--card)] rounded-xl shadow-sm border border-gray-200 dark:border-[var(--border)] overflow-hidden">
          <div className="bg-[#1a1a2e] px-8 py-6">
            <h1 className="text-white text-xl font-semibold">EnriqueceAI</h1>
          </div>
          <div className="p-8 text-center">
            <p className="text-gray-600 dark:text-[var(--muted-foreground)]">{message}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
