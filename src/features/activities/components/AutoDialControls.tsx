'use client';

import { Pause, Play, PhoneForwarded, SkipForward, Zap } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Switch } from '@/shared/components/ui/switch';

import { describeAutoDial, type AutoDialState } from '../utils/auto-dialer';

/** Chave "Discagem automática" — só com o webphone embutido pronto. */
export function AutoDialToggle({
  enabled,
  available,
  onChange,
  className,
}: {
  enabled: boolean;
  /** Webphone registrado nesta aba (sem ele a página não atende sozinha). */
  available: boolean;
  onChange: (enabled: boolean) => void;
  className?: string;
}) {
  const hint = available
    ? 'Liga o próximo lead sozinho; para quando alguém atende.'
    : 'Disponível com o webphone ligado e verde nesta aba.';
  return (
    <label className={cn('flex items-center gap-2 text-sm', !available && 'opacity-60', className)} title={hint}>
      <Switch checked={enabled && available} onCheckedChange={onChange} disabled={!available} aria-label="Discagem automática" />
      <Zap className="h-3.5 w-3.5 text-amber-500" aria-hidden />
      <span className="font-medium">Discagem automática</span>
    </label>
  );
}

/**
 * Faixa de status da discagem automática: contagem regressiva com Pausar,
 * Ligar agora e Pular; motivo quando parada.
 */
export function AutoDialStatusBar({
  state,
  leadName,
  canResume,
  onPause,
  onResume,
  onDialNow,
  onSkip,
}: {
  state: AutoDialState;
  leadName: string | null;
  /** Retomar só sem ligação em aberto (o SDR concluiu a anterior). */
  canResume: boolean;
  onPause: () => void;
  onResume: () => void;
  onDialNow: () => void;
  onSkip: () => void;
}) {
  const text = describeAutoDial(state);
  if (!text) return null;
  const tone =
    state.phase === 'paused'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300'
      : state.phase === 'awaiting-sdr'
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
        : 'border-[var(--primary)]/30 bg-[var(--primary)]/5';

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3', tone)} role="status" aria-live="polite">
      <div className="flex min-w-0 items-center gap-2">
        <Zap className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
        <p className="truncate text-sm font-medium">
          {text}
          {state.phase === 'countdown' && leadName ? ` — ${leadName}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {state.phase === 'countdown' && (
          <>
            <Button size="sm" variant="outline" onClick={onSkip}>
              <SkipForward className="mr-1.5 h-3.5 w-3.5" />
              Pular
            </Button>
            <Button size="sm" onClick={onDialNow}>
              <PhoneForwarded className="mr-1.5 h-3.5 w-3.5" />
              Ligar agora
            </Button>
          </>
        )}
        {state.phase === 'paused' ? (
          <Button size="sm" onClick={onResume} disabled={!canResume} title={canResume ? undefined : 'Conclua a ligação atual para retomar'}>
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Retomar
          </Button>
        ) : (
          state.phase !== 'awaiting-sdr' && (
            <Button size="sm" variant="ghost" onClick={onPause}>
              <Pause className="mr-1.5 h-3.5 w-3.5" />
              Pausar
            </Button>
          )
        )}
      </div>
    </div>
  );
}
