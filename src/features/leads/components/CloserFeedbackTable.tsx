'use client';

import { Badge } from '@/shared/components/ui/badge';

import type { CloserFeedbackRow } from '../actions/fetch-closer-feedbacks';

const RESULT_LABELS: Record<string, string> = {
  meeting_done: 'Reunião realizada',
  no_show: 'Não compareceu',
  rescheduled: 'Remarcou',
};

function getResultLabel(result: string | null): string {
  if (!result) return '—';
  return RESULT_LABELS[result] ?? result;
}

const RESULT_BADGE: Record<string, string> = {
  meeting_done: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  no_show: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  rescheduled: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
};

function StarRating({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-[var(--muted-foreground)]">—</span>;
  return (
    <span className="text-[#E53935]" title={`${rating}/5`}>
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  );
}

interface CloserFeedbackTableProps {
  feedbacks: CloserFeedbackRow[];
}

export function CloserFeedbackTable({ feedbacks }: CloserFeedbackTableProps) {
  if (feedbacks.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">
        Nenhum feedback de closer registrado.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-[var(--muted)]/50">
            <th className="p-3 text-left font-medium">Lead</th>
            <th className="p-3 text-left font-medium">Closer</th>
            <th className="p-3 text-left font-medium">Resultado</th>
            <th className="p-3 text-center font-medium">Nota</th>
            <th className="p-3 text-left font-medium">Comentário</th>
            <th className="p-3 text-left font-medium">Status</th>
            <th className="p-3 text-left font-medium">Enviado</th>
          </tr>
        </thead>
        <tbody>
          {feedbacks.map((fb) => {
            const isExpired = !fb.responded_at && new Date(fb.expires_at) < new Date();
            return (
              <tr key={fb.id} className="border-b last:border-0">
                <td className="p-3 font-medium">{fb.lead_name}</td>
                <td className="p-3">
                  <div>{fb.closer_name}</div>
                  <div className="text-xs text-[var(--muted-foreground)]">{fb.closer_email}</div>
                </td>
                <td className="p-3">
                  {fb.result ? (
                    <Badge variant="outline" className={RESULT_BADGE[fb.result] ?? ''}>
                      {getResultLabel(fb.result)}
                    </Badge>
                  ) : (
                    <span className="text-[var(--muted-foreground)]">—</span>
                  )}
                </td>
                <td className="p-3 text-center">
                  <StarRating rating={fb.rating} />
                </td>
                <td className="p-3 max-w-[200px]">
                  <span className="line-clamp-2 text-xs">{fb.comment || '—'}</span>
                </td>
                <td className="p-3">
                  {fb.responded_at ? (
                    <Badge variant="outline" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                      Respondido
                    </Badge>
                  ) : isExpired ? (
                    <Badge variant="outline" className="bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                      Expirado
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                      Pendente
                    </Badge>
                  )}
                </td>
                <td className="p-3 text-xs text-[var(--muted-foreground)]">
                  {new Date(fb.sent_at).toLocaleDateString('pt-BR')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
