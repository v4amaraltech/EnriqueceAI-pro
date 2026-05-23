'use client';

import { useEffect, useState } from 'react';

import { Check, ChevronDown, Circle, Clock, Mail, MessageCircle, Phone, Search, Linkedin } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/utils/format';

import { fetchCadencePrograms, type CadenceProgram, type CadenceProgramStep } from '@/features/cadences/actions/fetch-cadence-program';

const CHANNEL_ICON: Record<string, typeof Phone> = {
  phone: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  linkedin: Linkedin,
  research: Search,
};

const CHANNEL_LABEL: Record<string, string> = {
  phone: 'Ligação',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  linkedin: 'LinkedIn',
  research: 'Pesquisa',
};

interface CadenceProgramCardProps {
  leadId: string;
}

export function CadenceProgramCard({ leadId }: CadenceProgramCardProps) {
  const [programs, setPrograms] = useState<CadenceProgram[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  /* eslint-disable react-hooks/set-state-in-effect -- fetch-on-mount pattern */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCadencePrograms(leadId).then((res) => {
      if (cancelled) return;
      if (res.success) setPrograms(res.data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [leadId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="text-sm text-[var(--muted-foreground)]">Carregando programação da cadência…</p>
      </div>
    );
  }

  if (!programs || programs.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Programação da cadência</h3>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            {programs.length === 1
              ? `${programs[0]!.cadenceName} — ${programs[0]!.steps.length} passos`
              : `${programs.length} cadências ativas`}
          </p>
        </div>
        <ChevronDown className={cn('h-4 w-4 text-[var(--muted-foreground)] transition-transform', !expanded && '-rotate-90')} />
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
          {programs.map((program) => (
            <div key={program.enrollmentId} className="p-4 space-y-3">
              {programs.length > 1 && (
                <p className="text-xs font-semibold text-[var(--foreground)]">{program.cadenceName}</p>
              )}
              <ol className="space-y-2">
                {program.steps.map((step) => (
                  <StepRow key={step.stepId} step={step} />
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: CadenceProgramStep }) {
  const Icon = CHANNEL_ICON[step.channel] ?? Circle;
  const channelLabel = CHANNEL_LABEL[step.channel] ?? step.channel;

  const indicator = step.status === 'executed'
    ? <Check className="h-4 w-4 text-emerald-500" />
    : step.status === 'current'
      ? <Clock className="h-4 w-4 text-amber-500 animate-pulse" />
      : <Circle className="h-4 w-4 text-[var(--muted-foreground)]" />;

  const title = step.activityName || channelLabel;
  const dateLabel = step.date
    ? step.status === 'executed'
      ? `Executado em ${formatDate(step.date)}`
      : `Agendado para ${formatDate(step.date)}`
    : null;

  return (
    <li className={cn(
      'flex items-start gap-3 rounded-md px-2 py-1.5',
      step.status === 'current' && 'bg-amber-500/5 ring-1 ring-amber-500/20',
    )}>
      <div className="mt-0.5 shrink-0">{indicator}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs font-mono text-[var(--muted-foreground)]">{step.dayLabel}</span>
          <Icon className="h-3.5 w-3.5 text-[var(--muted-foreground)] shrink-0" />
          <span className={cn(
            'text-sm',
            step.status === 'executed' ? 'text-[var(--muted-foreground)] line-through' : 'text-[var(--foreground)]',
            step.status === 'current' && 'font-medium',
          )}>
            {title}
          </span>
        </div>
        {dateLabel && (
          <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{dateLabel}</p>
        )}
      </div>
    </li>
  );
}
