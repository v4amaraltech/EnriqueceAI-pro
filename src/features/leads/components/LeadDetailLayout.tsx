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
import { Checkbox } from '@/shared/components/ui/checkbox';
import type { LossReasonRow } from '@/features/settings-prospecting/actions/loss-reasons-crud';
import type { CrmPipeline, CrmProvider } from '@/features/integrations/types/crm';

import { enrichLeadAction } from '../actions/enrich-lead';
import { enrichLeadWithApollo } from '../actions/enrich-lead-apollo';
import type { LeadEnrollmentData } from '../actions/fetch-lead-enrollment';
import { archiveLead, fetchCrmPipelines, fetchLossReasons, markLeadAsLost, markLeadAsWon } from '../actions/update-lead';
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

  // Won dialog state
  const [showWonDialog, setShowWonDialog] = useState(false);
  const [sendToCrm, setSendToCrm] = useState(false);
  const [crmData, setCrmData] = useState<{ provider: CrmProvider | null; pipelines: CrmPipeline[] }>({ provider: null, pipelines: [] });
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [loadingPipelines, setLoadingPipelines] = useState(false);

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

  const handleOpenWonDialog = useCallback(async () => {
    setShowWonDialog(true);
    setSendToCrm(false);
    setSelectedPipelineId(null);
    setSelectedStageId(null);
    setCrmData({ provider: null, pipelines: [] });
    setLoadingPipelines(true);
    const result = await fetchCrmPipelines();
    setLoadingPipelines(false);
    if (result.success) {
      setCrmData(result.data);
      if (result.data.provider && result.data.pipelines.length > 0) {
        setSendToCrm(true);
      }
    }
  }, []);

  const handleConfirmWon = useCallback(() => {
    startTransition(async () => {
      const crmOptions = sendToCrm && crmData.provider && selectedPipelineId && selectedStageId
        ? { provider: crmData.provider, pipelineId: selectedPipelineId, stageId: selectedStageId }
        : undefined;

      const result = await markLeadAsWon(lead.id, crmOptions);
      if (result.success) {
        if (result.data.dealCreated) {
          toast.success('Lead marcado como ganho e enviado ao CRM');
        } else {
          toast.success('Lead marcado como ganho');
        }
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
    setShowWonDialog(false);
  }, [lead.id, sendToCrm, crmData.provider, selectedPipelineId, selectedStageId, router]);

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
        onShowWon={handleOpenWonDialog}
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

      {/* Won dialog */}
      <Dialog open={showWonDialog} onOpenChange={setShowWonDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">Marcar lead como ganho</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            {loadingPipelines ? (
              <p className="text-sm text-[var(--muted-foreground)]">Carregando funis do CRM...</p>
            ) : crmData.provider && crmData.pipelines.length > 0 ? (
              <>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="send-to-crm"
                    checked={sendToCrm}
                    onCheckedChange={(checked) => {
                      setSendToCrm(checked === true);
                      if (!checked) {
                        setSelectedPipelineId(null);
                        setSelectedStageId(null);
                      }
                    }}
                  />
                  <Label htmlFor="send-to-crm" className="text-sm font-semibold">
                    Enviar ao CRM ({crmData.provider === 'pipedrive' ? 'Pipedrive' : crmData.provider})
                  </Label>
                </div>
                {sendToCrm && (
                  <>
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">Funil</Label>
                      <Select
                        value={selectedPipelineId ?? undefined}
                        onValueChange={(value) => {
                          setSelectedPipelineId(value);
                          setSelectedStageId(null);
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecione o funil" />
                        </SelectTrigger>
                        <SelectContent>
                          {crmData.pipelines.map((pipeline) => (
                            <SelectItem key={pipeline.id} value={pipeline.id}>
                              {pipeline.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedPipelineId && (
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold">Etapa</Label>
                        <Select
                          value={selectedStageId ?? undefined}
                          onValueChange={setSelectedStageId}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Selecione a etapa" />
                          </SelectTrigger>
                          <SelectContent>
                            {crmData.pipelines
                              .find((p) => p.id === selectedPipelineId)
                              ?.stages.map((stage) => (
                                <SelectItem key={stage.id} value={stage.id}>
                                  {stage.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">
                {crmData.provider
                  ? 'Funis não disponíveis para este CRM.'
                  : 'Nenhum CRM conectado. O lead será marcado como ganho sem enviar ao CRM.'}
              </p>
            )}
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setShowWonDialog(false)}>
              Cancelar
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={handleConfirmWon}
              disabled={isPending || (sendToCrm && (!selectedPipelineId || !selectedStageId))}
            >
              Confirmar ganho
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
