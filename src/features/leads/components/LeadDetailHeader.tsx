'use client';

import { useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Calendar,
  CalendarX,
  ChevronLeft,
  Globe,
  Mail,
  MoreHorizontal,
  Phone,
  RefreshCw,
  RotateCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import { resyncLeadToCrm } from '../actions/lead-crm';
import { markMeetingNoShow } from '../actions/lead-noshow';
import { updateLead } from '../actions/update-lead';
import type { LeadRow } from '../types';

interface LeadDetailHeaderProps {
  lead: LeadRow;
  onShowEmail: () => void;
  onShowCadence: () => void;
  onShowAI: () => void;
  onShowMeeting: () => void;
  onShowLost: () => void;
  onShowWon: () => void;
  onEnrichApollo: () => void;
  onReenrichApollo: () => void;
  onCall?: () => void;
  isEnriching?: boolean;
  isCalling?: boolean;
}

export function LeadDetailHeader({
  lead,
  onShowEmail,
  onShowCadence,
  onShowAI,
  onShowMeeting,
  onShowLost,
  onShowWon,
  onEnrichApollo,
  onReenrichApollo,
  onCall,
  isEnriching,
  isCalling,
}: LeadDetailHeaderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isResyncing, startResyncTransition] = useTransition();

  const handleResyncKommo = useCallback(() => {
    startResyncTransition(async () => {
      const result = await resyncLeadToCrm(lead.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const { fieldsTotal, succeeded, failed, failedKeys } = result.data;
      if (failed > 0) {
        toast.warning(
          `Resincronizado: ${succeeded}/${fieldsTotal} campos. ${failed} falharam (${failedKeys.slice(0, 3).join(', ')}${failedKeys.length > 3 ? '…' : ''}).`,
          { duration: 8000 },
        );
      } else {
        toast.success(`Lead resincronizado com Kommo (${fieldsTotal} campos enviados).`);
      }
      router.refresh();
    });
  }, [lead.id, router]);

  const handleNoShow = useCallback(() => {
    startTransition(async () => {
      const result = await markMeetingNoShow(lead.id);
      if (result.success) {
        toast.success('No-show registrado — follow-up criado na fila do SDR');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [lead.id, router]);

  const contactName = lead.first_name ? `${lead.first_name} ${lead.last_name ?? ''}`.trim() : null;
  const personName = contactName ?? lead.socios?.[0]?.nome ?? null;
  const companyName = lead.nome_fantasia ?? lead.razao_social ?? null;
  const primaryName = personName ?? companyName ?? '—';
  const secondaryName = personName ? companyName : null;

  const isWon = lead.status === 'won';
  const isLost = lead.status === 'unqualified';
  const isClosed = isWon || isLost;

  const handleReopen = useCallback(() => {
    // Reopen: determine the right status to return to
    let reopenStatus: string = 'contacted';
    if (isWon && lead.meeting_scheduled_at) {
      // Was won → reopen to qualified (reunião agendada) and clear won_at + meeting_held_at
      reopenStatus = 'qualified';
    } else if (isLost && (lead.qualified_at || lead.meeting_scheduled_at)) {
      reopenStatus = 'qualified';
    } else if (lead.contacted_at) {
      reopenStatus = 'contacted';
    }

    startTransition(async () => {
      const updates: Record<string, unknown> = { status: reopenStatus };
      // Clear won_at + meeting_held_at when reopening from won state.
      // The trigger keys off meeting_held_at, so we must clear it here too.
      if (isWon) {
        updates.won_at = null;
        updates.meeting_held_at = null;
      }
      const result = await updateLead(lead.id, updates);
      if (result.success) {
        toast.success('Lead reaberto');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [lead.id, lead.contacted_at, lead.qualified_at, lead.meeting_scheduled_at, isWon, isLost, router]);

  return (
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => router.back()}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{primaryName}</h1>
          {secondaryName && (
            <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{secondaryName}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {lead.telefone && (
          <Button
            variant="outline"
            size="sm"
            onClick={onCall}
            disabled={isCalling}
          >
            <Phone className="mr-1 h-4 w-4" />
            {isCalling ? 'Ligando...' : 'Ligar'}
          </Button>
        )}
        {isClosed ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleReopen}
            disabled={isPending}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            Reabrir
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              onClick={onShowWon}
              disabled={isPending}
            >
              <ThumbsUp className="mr-1 h-4 w-4" />
              Ganho
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onShowLost}
              disabled={isPending}
            >
              <ThumbsDown className="mr-1 h-4 w-4" />
              Perdido
            </Button>
          </>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onShowEmail}>
              <Mail className="mr-2 h-3.5 w-3.5" />
              Enviar Email
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onShowCadence}>
              <Zap className="mr-2 h-3.5 w-3.5" />
              Inscrever em Cadência
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onShowAI}>
              <Sparkles className="mr-2 h-3.5 w-3.5" />
              Gerar com IA
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onShowMeeting}>
              <Calendar className="mr-2 h-3.5 w-3.5" />
              Agendar Reunião
            </DropdownMenuItem>
            {lead.meeting_scheduled_at && lead.status !== 'unqualified' && (
              <DropdownMenuItem onClick={handleNoShow} disabled={isPending}>
                <CalendarX className="mr-2 h-3.5 w-3.5" />
                Reunião não aconteceu
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {lead.source_id ? (
              <DropdownMenuItem onClick={onReenrichApollo} disabled={isEnriching}>
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isEnriching ? 'animate-spin' : ''}`} />
                {isEnriching ? 'Enriquecendo...' : 'Re-enriquecer (Apollo)'}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onEnrichApollo} disabled={isEnriching}>
                <Globe className={`mr-2 h-3.5 w-3.5 ${isEnriching ? 'animate-spin' : ''}`} />
                {isEnriching ? 'Enriquecendo...' : 'Enriquecer com Apollo'}
              </DropdownMenuItem>
            )}
            {isWon && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleResyncKommo} disabled={isResyncing}>
                  <RotateCw className={`mr-2 h-3.5 w-3.5 ${isResyncing ? 'animate-spin' : ''}`} />
                  {isResyncing ? 'Resincronizando...' : 'Resincronizar com Kommo'}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
