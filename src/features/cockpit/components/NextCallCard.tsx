'use client';

import { useRef, useState } from 'react';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Building2, ExternalLink, PhoneCall } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';

import { initiateApi4ComCall } from '@/features/calls/actions/initiate-api4com-call';

import { armCockpitCallOutcomeAction } from '../actions/call-outcome';
import type { NextCallCardData } from '../types';
import { relativeTimePt, sourceLabel, summarizeContext } from '../utils/call-approach';

import { CallOutcomePanel } from './CallOutcomePanel';

const NO_DATA = 'sem dados';

interface NextCallCardProps {
  card: NextCallCardData;
  /** Provedor de telefonia do usuário; só `api4com` habilita o botão. */
  dialerProvider: 'api4com' | null;
  /** Flag `call_cockpit_outcomes`: mostra resultado e resumo após a ligação. Ausente = como antes. */
  outcomesEnabled?: boolean;
}

/**
 * Cartão da próxima ligação. A ligação só começa com o clique do usuário e usa
 * a action existente da API4Com; nada disca sozinho.
 */
export function NextCallCard({ card, dialerProvider, outcomesEnabled = false }: NextCallCardProps) {
  const { context: ctx, approach, priority } = card;
  const now = new Date(card.generatedAt);
  const phone = ctx.decisionMaker.phone;
  const [calling, setCalling] = useState(false);
  const [startedCallId, setStartedCallId] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const inFlight = useRef(false);

  const canCall = dialerProvider === 'api4com' && Boolean(phone);
  const summary = summarizeContext(ctx);

  async function handleCall() {
    // Trava síncrona: clique duplo antes do re-render não cria uma segunda chamada.
    if (inFlight.current || !phone) return;
    inFlight.current = true;
    setCalling(true);
    try {
      const result = await initiateApi4ComCall({ phone, leadId: ctx.leadId });
      if (result.success) {
        toast.success('Ligação iniciada');
        if (outcomesEnabled) {
          setStartedCallId(result.data.callId);
          // Falha ao armar não afeta a ligação: o cartão só fica sem resumo automático.
          void armCockpitCallOutcomeAction({ callId: result.data.callId }).catch(() => undefined);
        }
      } else toast.error(result.error);
    } catch {
      toast.error('Erro ao iniciar a ligação');
    } finally {
      inFlight.current = false;
      setCalling(false);
    }
  }

  function handleNext() {
    const params = new URLSearchParams(searchParams.toString());
    params.set('skip', ctx.leadId);
    router.push(`${pathname}?${params.toString()}`);
  }

  const disabledReason = !phone
    ? 'Lead sem telefone'
    : dialerProvider !== 'api4com'
      ? 'Conecte a API4Com para ligar'
      : null;

  return (
    <section className="space-y-4 rounded-lg border border-[var(--primary)]/40 bg-[var(--card)] p-4" aria-label="Próxima ligação" data-testid="next-call-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground text-xs font-medium">Próxima ligação</p>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Building2 className="h-4 w-4 shrink-0" />
            <span className="truncate">{ctx.company.name}</span>
          </h2>
          <p className="text-sm" data-testid="why-now">
            <span className="font-medium">Por que ligar agora:</span> {ctx.whyNow.label}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/leads/${ctx.leadId}`}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Ver lead
            </Link>
          </Button>
          <Button size="sm" onClick={handleCall} disabled={!canCall || calling} title={disabledReason ?? undefined}>
            <PhoneCall className="mr-1.5 h-3.5 w-3.5" />
            {calling ? 'Ligando...' : 'Ligar agora'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 text-sm md:grid-cols-2">
        <div className="space-y-1">
          <h3 className="text-xs font-semibold">Decisor</h3>
          <p>{ctx.decisionMaker.name ?? NO_DATA}</p>
          <p className="text-muted-foreground text-xs">
            {ctx.decisionMaker.jobTitle ?? NO_DATA} · {phone ?? NO_DATA}
          </p>
        </div>

        <div className="space-y-1">
          <h3 className="text-xs font-semibold">Sinais</h3>
          {ctx.signals.length === 0 ? (
            <p className="text-muted-foreground text-xs">{NO_DATA}</p>
          ) : (
            <ul className="space-y-0.5 text-xs">
              {ctx.signals.slice(0, 3).map((s, i) => (
                <li key={`${s.kind}-${s.at}-${i}`}>
                  {signalLabel(s.kind)} por {sourceLabel(s.source)}, {relativeTimePt(s.at, now)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-1">
          <h3 className="text-xs font-semibold">Resumo</h3>
          <p className="text-xs">{summary ?? NO_DATA}</p>
        </div>

        <div className="space-y-1">
          <h3 className="text-xs font-semibold">Objeções</h3>
          {ctx.objections === null ? (
            <p className="text-muted-foreground text-xs">{NO_DATA}</p>
          ) : ctx.objections.length === 0 ? (
            <p className="text-xs">Nenhuma registrada</p>
          ) : (
            <ul className="list-disc pl-4 text-xs">
              {ctx.objections.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-1 rounded-md border p-3" data-testid="approach">
        <h3 className="text-xs font-semibold">Abordagem sugerida ({approach.version}, por regras)</h3>
        {priority && (
          <p className="text-muted-foreground text-xs" data-testid="priority-source">
            Prioridade {priority.version} · fonte: {priority.sourceLabel ?? 'sem sinal'} · pontuação {priority.score}
          </p>
        )}
        <p className="text-sm font-medium">{approach.headline}</p>
        <p className="text-xs">{approach.opening}</p>
        <p className="text-xs">
          <span className="font-medium">Objetivo:</span> {approach.goal}
        </p>
        {approach.points.length > 0 && (
          <ul className="list-disc pl-4 text-xs">
            {approach.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>

      {outcomesEnabled && startedCallId && (
        <CallOutcomePanel key={startedCallId} callId={startedCallId} leadId={ctx.leadId} onNext={handleNext} />
      )}
    </section>
  );
}

function signalLabel(kind: string): string {
  switch (kind) {
    case 'replied':
      return 'Respondeu';
    case 'clicked':
      return 'Clicou';
    case 'opened':
      return 'Abriu';
    case 'meeting_scheduled':
      return 'Reunião marcada';
    case 'bounced':
      return 'Retornou erro';
    case 'callback_requested':
      return 'Pediu retorno';
    default:
      return kind;
  }
}
