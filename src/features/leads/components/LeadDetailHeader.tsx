'use client';

import { useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive,
  Calendar,
  ChevronLeft,
  Globe,
  Mail,
  MoreHorizontal,
  Phone,
  RefreshCw,
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

import { updateLead } from '../actions/update-lead';
import type { LeadRow } from '../types';

interface LeadDetailHeaderProps {
  lead: LeadRow;
  onShowEmail: () => void;
  onShowCadence: () => void;
  onShowAI: () => void;
  onShowMeeting: () => void;
  onShowArchive: () => void;
  onShowLost: () => void;
  onShowWon: () => void;
  onEnrich: () => void;
  onEnrichApollo: () => void;
  onReenrichApollo: () => void;
  isEnriching?: boolean;
}

export function LeadDetailHeader({
  lead,
  onShowEmail,
  onShowCadence,
  onShowAI,
  onShowMeeting,
  onShowArchive,
  onShowLost,
  onShowWon,
  onEnrich,
  onEnrichApollo,
  onReenrichApollo,
  isEnriching,
}: LeadDetailHeaderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const contactName = lead.first_name ? `${lead.first_name} ${lead.last_name ?? ''}`.trim() : null;
  const personName = contactName ?? lead.socios?.[0]?.nome ?? null;
  const companyName = lead.nome_fantasia ?? lead.razao_social ?? null;
  const primaryName = personName ?? companyName ?? '—';
  const secondaryName = personName ? companyName : null;

  const isClosed = lead.status === 'qualified' || lead.status === 'unqualified';

  const handleStatusChange = useCallback((status: 'qualified' | 'contacted') => {
    startTransition(async () => {
      const result = await updateLead(lead.id, { status });
      if (result.success) {
        const messages: Record<string, string> = {
          qualified: 'Lead marcado como ganho',
          contacted: 'Lead reaberto',
        };
        toast.success(messages[status]);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [lead.id, router]);

  return (
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => router.push('/leads')}
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
          <Button variant="outline" size="sm" asChild>
            <a href={`tel:${lead.telefone}`}>
              <Phone className="mr-1 h-4 w-4" />
              Ligar
            </a>
          </Button>
        )}
        {isClosed ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleStatusChange('contacted')}
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
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onEnrich} disabled={isEnriching}>
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isEnriching ? 'animate-spin' : ''}`} />
              {isEnriching ? 'Enriquecendo...' : 'Enriquecer (CNPJ)'}
            </DropdownMenuItem>
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
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onShowArchive} className="text-red-600">
              <Archive className="mr-2 h-3.5 w-3.5" />
              Arquivar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
