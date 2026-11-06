import { Badge } from '@/shared/components/ui/badge';

import { AI_DISPOSITION_LABELS, type AiOutcome } from '../ai-outcome';

/**
 * "Resultado pela IA" de uma ligação do Power Dialer (+ selo "Revisar" quando a
 * IA ficou em dúvida ou falhou). Mostrado no histórico da ligação na timeline.
 */
export function CallAiOutcome({ outcome }: { outcome: AiOutcome | null | undefined }) {
  if (!outcome) return null;

  if (outcome.status === 'pending' || outcome.status === 'processing') {
    return (
      <p className="mt-1 text-xs italic text-muted-foreground" data-testid="call-ai-outcome">
        Resultado pela IA: analisando a gravação…
      </p>
    );
  }

  const review = outcome.needs_review || outcome.status === 'failed';
  const label =
    outcome.status === 'failed'
      ? 'não foi possível classificar'
      : outcome.disposition
        ? AI_DISPOSITION_LABELS[outcome.disposition]
        : '—';
  const callback =
    outcome.status === 'done' && outcome.callback_at
      ? new Date(outcome.callback_at).toLocaleString('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'America/Sao_Paulo',
        })
      : null;

  return (
    <div className="mt-1 space-y-1 text-xs" data-testid="call-ai-outcome">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">Resultado pela IA:</span>
        <span>{label}</span>
        {review && (
          <Badge variant="outline" className="h-4 border-amber-500/50 px-1 text-[10px] text-amber-600">
            Revisar
          </Badge>
        )}
      </div>
      {callback && <p className="text-muted-foreground">Retorno agendado para {callback}</p>}
      {outcome.status === 'done' && outcome.summary && (
        <p className="whitespace-pre-line text-muted-foreground">{outcome.summary}</p>
      )}
    </div>
  );
}
