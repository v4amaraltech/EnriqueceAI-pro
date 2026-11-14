'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

import {
  LEAD_ANSWER_MAX_POLLS,
  LEAD_ANSWER_POLL_INTERVAL_MS,
  OUT_OF_AREA_LABEL,
  isOutOfAreaCall,
} from '@/features/integrations/webphone/webphone-lead-answer';

import { getCockpitCallOutcome } from '../actions/call-outcome';
import type { CockpitCallOutcome } from '../types';
import { dispositionLabel } from '../utils/call-outcome-view';

import { VerbalConsentButton } from './VerbalConsentButton';

interface CallOutcomePanelProps {
  callId: string;
  leadId: string;
  /** Segue para a próxima ligação. Nunca fica desabilitado por resultado pendente. */
  onNext: () => void;
}

function isFinal(outcome: CockpitCallOutcome): boolean {
  return outcome.state === 'confirmed' || outcome.state === 'exception' || outcome.state === 'not_answered' || outcome.state === 'none';
}

/**
 * Resultado e resumo da ligação iniciada pelo cartão. Consulta o servidor até o
 * estado ficar definitivo; transcrição e resumo pendentes são só informativos e
 * o botão "Próxima ligação" continua disponível o tempo todo.
 */
export function CallOutcomePanel({ callId, leadId, onNext }: CallOutcomePanelProps) {
  const [outcome, setOutcome] = useState<CockpitCallOutcome>({ state: 'waiting_call' });
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    async function tick() {
      polls += 1;
      try {
        const res = await getCockpitCallOutcome({ callId });
        if (cancelled) return;
        if (res.success && res.data.status === 'ok') {
          setOutcome(res.data.outcome);
          if (isFinal(res.data.outcome)) return;
        }
      } catch {
        // Falha de rede: tenta de novo no próximo ciclo.
      }
      if (cancelled) return;
      if (polls >= LEAD_ANSWER_MAX_POLLS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(tick, LEAD_ANSWER_POLL_INTERVAL_MS);
    }

    timer = setTimeout(tick, LEAD_ANSWER_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [callId]);

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="call-outcome" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">Resultado da ligação</h3>
        <Button size="sm" variant="outline" onClick={onNext} data-testid="next-lead-button">
          Próxima ligação
        </Button>
      </div>
      <OutcomeBody outcome={outcome} leadId={leadId} gaveUp={gaveUp} />
      <VerbalConsentButton callId={callId} />
    </div>
  );
}

function OutcomeBody({ outcome, leadId, gaveUp }: { outcome: CockpitCallOutcome; leadId: string; gaveUp: boolean }) {
  switch (outcome.state) {
    case 'waiting_call':
      return <p className="text-muted-foreground text-xs">{gaveUp ? 'Sem retorno da operadora ainda. Você pode seguir para a próxima.' : 'Aguardando o fim da ligação.'}</p>;
    case 'pending':
      return (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs" data-testid="outcome-pending">
          {!gaveUp && <Loader2 className="h-3 w-3 animate-spin" />}
          {outcome.stage === 'transcription' ? 'Transcrição em andamento.' : 'Resumo em andamento.'} Você pode seguir para a próxima ligação.
        </p>
      );
    case 'not_answered':
      return <p className="text-xs" data-testid="outcome-not-answered">{isOutOfAreaCall({ hangupCause: outcome.hangupCause }) ? OUT_OF_AREA_LABEL : 'Não atendeu'}. Não há resumo para esta ligação.</p>;
    case 'none':
      return <p className="text-muted-foreground text-xs">Esta ligação não tem resultado automático. Registre o resultado na linha do tempo do lead.</p>;
    case 'confirmed':
      return (
        <div className="space-y-1" data-testid="outcome-confirmed">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            {dispositionLabel(outcome.disposition, outcome.hangupCause)}
            <span className="text-muted-foreground text-xs font-normal">({outcome.source === 'sdr' ? 'registrado por você' : 'classificado pela IA'})</span>
          </p>
          <p className="text-xs">{outcome.summary ?? 'Sem resumo.'}</p>
          {outcome.callbackScheduled && outcome.callbackAt && (
            <p className="text-xs">Retorno agendado para {formatBrt(outcome.callbackAt)}.</p>
          )}
        </div>
      );
    case 'exception':
      return (
        <div className="space-y-1 rounded-md border border-amber-500/60 p-2" data-testid="outcome-exception">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Revisar resultado
          </p>
          <p className="text-xs">{exceptionText(outcome)}</p>
          {outcome.summary && <p className="text-xs">Resumo sugerido: {outcome.summary}</p>}
          <Button asChild size="sm" variant="outline">
            <Link href={`/leads/${leadId}`}>Revisar na linha do tempo</Link>
          </Button>
        </div>
      );
  }
}

function exceptionText(o: Extract<CockpitCallOutcome, { state: 'exception' }>): string {
  if (o.reason === 'failed') return 'A IA não conseguiu classificar a ligação. Nada foi aplicado.';
  if (o.reason === 'apply_failed') return 'O resultado não pôde ser aplicado por completo. Confira antes de seguir.';
  const pct = o.confidence === null ? '' : ` (confiança ${Math.round(o.confidence * 100)}%)`;
  return `A IA sugeriu "${dispositionLabel(o.suggestedDisposition)}"${pct}, mas a confiança é baixa. Nada foi aplicado até você confirmar.`;
}

function formatBrt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
}
