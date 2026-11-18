'use client';

import { Pause, Play, PhoneOff, Square, Zap } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';

import type { UseCockpitAutoDialResult } from '../hooks/use-cockpit-auto-dial';
import { AUTO_DIAL_RULES } from '../utils/auto-dial-rules';
import { isCallInProgress } from '../utils/cockpit-auto-dial-machine';

interface CockpitAutoDialBarProps {
  engine: UseCockpitAutoDialResult;
  /** Ligações do motor nesta sessão (o hook não expõe o total do dia). */
  sessionCalls: number;
  /** Encerra a ligação em curso (só no modo real). Separado do Parar (FR-13). */
  onHangup?: () => void;
}

const brtTime = (ms: number) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(ms);

/** Texto do estado em português simples (spec §3). */
export function autoDialStatusLine(engine: Pick<UseCockpitAutoDialResult, 'state' | 'statusText'>): string {
  const s = engine.state;
  switch (s.phase) {
    case 'off':
      return 'Discagem desligada';
    case 'countdown':
      return `Discando em ${s.secondsLeft} s`;
    case 'dialing':
      return 'Discando…';
    case 'awaiting-session':
    case 'in-call':
      return 'Em ligação';
    case 'awaiting-sdr':
      return 'Aguardando o desfecho';
    case 'waiting':
      return `Próxima tentativa às ${brtTime(s.until)}`;
    case 'paused':
      return s.reason === 'user' ? 'Pausado' : `Pausado: ${s.message ?? 'confira a ligação'}`;
    case 'blocked':
      if (s.reason === 'outside_hours') return 'Fora do horário (seg-sex 8h-20h)';
      if (s.reason === 'daily_cap') return `Teto do dia atingido (${AUTO_DIAL_RULES.dailyCap})`;
      return engine.statusText ?? 'Discagem bloqueada';
    default:
      return engine.statusText ?? '';
  }
}

export function CockpitAutoDialBar({ engine, sessionCalls, onHangup }: CockpitAutoDialBarProps) {
  const { state, simulated } = engine;
  const skipped = engine.skippedLeads ?? [];
  const off = state.phase === 'off';
  const paused = state.phase === 'paused';
  const blocked = state.phase === 'blocked';
  const showHangup = !simulated && isCallInProgress(state) && Boolean(onHangup);

  return (
    <div className="space-y-2 rounded-md border bg-[var(--muted)]/40 p-3" data-testid="auto-dial-bar">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <Zap className="h-3.5 w-3.5" />
          Discagem automática
        </span>
        {simulated ? (
          <Badge variant="outline" className="border-amber-500 font-bold text-amber-600 dark:text-amber-400" data-testid="auto-dial-simulated">
            SIMULADO
          </Badge>
        ) : (
          <Badge variant="destructive" className="font-bold" data-testid="auto-dial-live">
            LIGAÇÃO REAL
          </Badge>
        )}
        {skipped.length > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground cursor-help text-xs underline decoration-dotted" tabIndex={0} data-testid="auto-dial-skipped">
                  {skipped.length} {skipped.length === 1 ? 'pulado' : 'pulados'}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Pulados por número inválido nesta sessão: {skipped.map((s) => s.reason).join('; ')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <span className="text-muted-foreground ml-auto text-xs tabular-nums" data-testid="auto-dial-counter">
          Ligações da discagem nesta sessão: {sessionCalls}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm" role="status" aria-live="polite" data-testid="auto-dial-status">
          {autoDialStatusLine(engine)}
        </p>
        {off && (
          <Button size="sm" onClick={() => void engine.start()} data-testid="auto-dial-start">
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Iniciar discagem
          </Button>
        )}
        {!off && !paused && !blocked && (
          <Button size="sm" variant="outline" onClick={engine.pause} data-testid="auto-dial-pause">
            <Pause className="mr-1.5 h-3.5 w-3.5" />
            Pausar
          </Button>
        )}
        {paused && (
          <Button size="sm" variant="outline" onClick={engine.resume} data-testid="auto-dial-resume">
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Retomar
          </Button>
        )}
        {!off && (
          <Button size="sm" variant="outline" onClick={engine.stop} data-testid="auto-dial-stop">
            <Square className="mr-1.5 h-3.5 w-3.5" />
            Parar
          </Button>
        )}
        {showHangup && (
          <Button size="sm" variant="destructive" onClick={onHangup} data-testid="auto-dial-hangup">
            <PhoneOff className="mr-1.5 h-3.5 w-3.5" />
            Desligar
          </Button>
        )}
      </div>
      {!off && isCallInProgress(state) && (
        <p className="text-muted-foreground text-xs">Parar não derruba a ligação em curso. Use Desligar para encerrá-la.</p>
      )}
    </div>
  );
}
