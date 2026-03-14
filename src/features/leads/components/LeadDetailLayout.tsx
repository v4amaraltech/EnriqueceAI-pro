'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Textarea } from '@/shared/components/ui/textarea';

import type { TimelineEntry } from '@/features/cadences/cadences.contract';
import { AIMessageGenerator } from '@/features/ai/components/AIMessageGenerator';
import type { LeadContext } from '@/features/ai/types';
import type { LossReasonRow } from '@/features/settings-prospecting/actions/loss-reasons-crud';

import { enrichLeadAction } from '../actions/enrich-lead';
import { enrichLeadWithApollo } from '../actions/enrich-lead-apollo';
import type { LeadEnrollmentData } from '../actions/fetch-lead-enrollment';
import { archiveLead, fetchLossReasons, markLeadAsLost } from '../actions/update-lead';
import type { LeadRow } from '../types';
import { CadenceProgressBar } from './CadenceProgressBar';
import { EnrollInCadenceDialog } from './EnrollInCadenceDialog';
import { LeadDetailHeader } from './LeadDetailHeader';
import { LeadDetailSidebar } from './LeadDetailSidebar';
import { LeadDetailTabs } from './LeadDetailTabs';
import { SendEmailDialog } from './SendEmailDialog';

interface LeadDetailLayoutProps {
  lead: LeadRow;
  timeline: TimelineEntry[];
  enrollmentData: LeadEnrollmentData;
}

export function LeadDetailLayout({ lead, timeline, enrollmentData }: LeadDetailLayoutProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Dialog state
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [showLostDialog, setShowLostDialog] = useState(false);
  const [showAIGenerator, setShowAIGenerator] = useState(false);
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [showEnrollCadence, setShowEnrollCadence] = useState(false);
  const [showMeeting, setShowMeeting] = useState(false);

  // Loss reason dialog state
  const [lossReasons, setLossReasons] = useState<LossReasonRow[]>([]);
  const [selectedReasonId, setSelectedReasonId] = useState<string | null>(null);
  const [lossNotes, setLossNotes] = useState('');

  const handleArchive = useCallback(() => {
    startTransition(async () => {
      const result = await archiveLead(lead.id);
      if (result.success) {
        toast.success('Lead arquivado');
        router.push('/leads');
      } else {
        toast.error(result.error);
      }
    });
    setShowArchiveDialog(false);
  }, [lead.id, router]);

  const handleEnrich = useCallback(() => {
    startTransition(async () => {
      const result = await enrichLeadAction(lead.id);
      if (result.success) {
        toast.success('Lead enriquecido com sucesso');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [lead.id, router]);

  const handleEnrichApollo = useCallback(() => {
    startTransition(async () => {
      const result = await enrichLeadWithApollo(lead.id);
      if (result.success) {
        toast.success('Lead enriquecido com Apollo');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [lead.id, router]);

  const handleReenrichApollo = useCallback(() => {
    startTransition(async () => {
      const result = await enrichLeadWithApollo(lead.id, true);
      if (result.success) {
        toast.success('Lead re-enriquecido com Apollo');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [lead.id, router]);

  const handleOpenLostDialog = useCallback(async () => {
    setShowLostDialog(true);
    setSelectedReasonId(null);
    setLossNotes('');
    const result = await fetchLossReasons();
    if (result.success) {
      setLossReasons(result.data);
    } else {
      toast.error(result.error);
    }
  }, []);

  const handleConfirmLost = useCallback(() => {
    if (!selectedReasonId) return;
    startTransition(async () => {
      const result = await markLeadAsLost(lead.id, selectedReasonId, lossNotes.trim() || undefined);
      if (result.success) {
        toast.success('Lead marcado como perdido');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
    setShowLostDialog(false);
  }, [lead.id, selectedReasonId, lossNotes, router]);

  return (
    <div className="space-y-4">
      <LeadDetailHeader
        lead={lead}
        onShowEmail={() => setShowSendEmail(true)}
        onShowCadence={() => setShowEnrollCadence(true)}
        onShowAI={() => setShowAIGenerator(true)}
        onShowMeeting={() => setShowMeeting(true)}
        onShowArchive={() => setShowArchiveDialog(true)}
        onShowLost={handleOpenLostDialog}
        onEnrich={handleEnrich}
        onEnrichApollo={handleEnrichApollo}
        onReenrichApollo={handleReenrichApollo}
        isEnriching={isPending}
      />

      {enrollmentData.enrollments.length > 0 && (
        <div className="rounded-lg border bg-[var(--card)] divide-y divide-[var(--border)]">
          {enrollmentData.enrollments.map((enr) => (
            enr.steps.length > 0 && (
              <CadenceProgressBar
                key={enr.cadence_name}
                steps={enr.steps}
                cadenceName={enr.cadence_name}
              />
            )
          ))}
        </div>
      )}

      <div className="flex gap-6">
        <LeadDetailSidebar lead={lead} enrollmentData={enrollmentData} timeline={timeline} />
        <LeadDetailTabs lead={lead} timeline={timeline} showMeeting={showMeeting} onShowMeetingChange={setShowMeeting} />
      </div>

      {/* Archive confirmation dialog */}
      <Dialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arquivar lead</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja arquivar este lead? O lead não aparecerá mais na lista principal.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowArchiveDialog(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleArchive} disabled={isPending}>
              Arquivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loss reason dialog */}
      <Dialog open={showLostDialog} onOpenChange={setShowLostDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">Desqualificar lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Motivo da perda</Label>
              <Select
                value={selectedReasonId ?? undefined}
                onValueChange={setSelectedReasonId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione o motivo" />
                </SelectTrigger>
                <SelectContent>
                  {lossReasons.map((reason) => (
                    <SelectItem key={reason.id} value={reason.id}>
                      {reason.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Razão da desqualificação</Label>
              <Textarea
                placeholder="Escreva aqui o que te levou a desqualificar esse lead."
                value={lossNotes}
                onChange={(e) => setLossNotes(e.target.value)}
                rows={6}
              />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setShowLostDialog(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmLost}
              disabled={!selectedReasonId || isPending}
            >
              Desqualificar lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Message Generator */}
      <AIMessageGenerator
        open={showAIGenerator}
        onOpenChange={setShowAIGenerator}
        leadContext={{
          nome_fantasia: lead.nome_fantasia,
          razao_social: lead.razao_social,
          cnpj: lead.cnpj,
          email: lead.email,
          telefone: lead.telefone,
          porte: lead.porte,
          cnae: lead.cnae,
          situacao_cadastral: lead.situacao_cadastral,
          faturamento_estimado: lead.faturamento_estimado,
          endereco: lead.endereco ? { cidade: lead.endereco.cidade, uf: lead.endereco.uf } : null,
          socios: lead.socios?.map((s) => ({ nome: s.nome, qualificacao: s.qualificacao })) ?? null,
        } satisfies LeadContext}
      />

      {/* Send Email Dialog */}
      <SendEmailDialog
        open={showSendEmail}
        onOpenChange={setShowSendEmail}
        leadId={lead.id}
        leadEmail={lead.email}
      />

      {/* Enroll in Cadence Dialog */}
      <EnrollInCadenceDialog
        open={showEnrollCadence}
        onOpenChange={setShowEnrollCadence}
        leadIds={[lead.id]}
      />
    </div>
  );
}
