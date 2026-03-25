'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Calendar } from '@/shared/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Switch } from '@/shared/components/ui/switch';
import { Textarea } from '@/shared/components/ui/textarea';

import type { TimelineEntry } from '@/features/cadences/cadences.contract';
import { AIMessageGenerator } from '@/features/ai/components/AIMessageGenerator';
import type { LeadContext } from '@/features/ai/types';
import { Checkbox } from '@/shared/components/ui/checkbox';
import type { LossReasonRow } from '@/features/settings-prospecting/actions/loss-reasons-crud';
import { listStandardFieldSettingsForMember } from '@/features/settings-prospecting/actions/standard-field-settings';
import type { CustomFieldRow } from '@/features/settings-prospecting/types/custom-field';
import type { CrmProvider } from '@/features/integrations/types/crm';

import type { LeadSourceOption } from '../actions/get-lead-source-options';
import { enrichLeadAction } from '../actions/enrich-lead';
import { updateLead } from '../actions/update-lead';
import type { MissingRequiredField } from '../utils/required-field-validation';
import { getMissingRequiredFields } from '../utils/required-field-validation';
import { enrichLeadWithApollo } from '../actions/enrich-lead-apollo';
import { fetchActiveCadences, type ActiveCadence } from '../actions/fetch-active-cadences';
import type { LeadEnrollmentData } from '../actions/fetch-lead-enrollment';
import { archiveLead, fetchLossReasons, markLeadAsLost, scheduleNewProspection } from '../actions/lead-lifecycle';
import { fetchCrmPipelines, fetchPipelineStages, markLeadAsWon, type CrmPipelinesEntry } from '../actions/lead-crm';
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
  customFieldDefs?: CustomFieldRow[];
  leadSourceOptions?: LeadSourceOption[];
}

export function LeadDetailLayout({ lead, timeline, enrollmentData, customFieldDefs, leadSourceOptions }: LeadDetailLayoutProps) {
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

  // Schedule new prospection state
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(undefined);
  const [scheduleCadenceId, setScheduleCadenceId] = useState<string | null>(null);
  const [cadences, setCadences] = useState<ActiveCadence[]>([]);

  // Won dialog state
  const [showWonDialog, setShowWonDialog] = useState(false);
  const [sendToCrm, setSendToCrm] = useState(false);
  const [crmConnections, setCrmConnections] = useState<CrmPipelinesEntry[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<CrmProvider | null>(null);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [stages, setStages] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingPipelines, setLoadingPipelines] = useState(false);
  const [loadingStages, setLoadingStages] = useState(false);

  // Won dialog — required fields validation
  const [wonMissingFields, setWonMissingFields] = useState<MissingRequiredField[]>([]);
  const [wonFieldValues, setWonFieldValues] = useState<Record<string, string>>({});
  const [loadingRequiredFields, setLoadingRequiredFields] = useState(false);

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
    setScheduleEnabled(false);
    setScheduleDate(undefined);
    setScheduleCadenceId(null);
    const [reasonsResult, cadencesResult] = await Promise.all([
      fetchLossReasons(),
      fetchActiveCadences(),
    ]);
    if (reasonsResult.success) {
      setLossReasons(reasonsResult.data);
    } else {
      toast.error(reasonsResult.error);
    }
    if (cadencesResult.success) {
      setCadences(cadencesResult.data);
    }
  }, []);

  const handleConfirmLost = useCallback(() => {
    if (!selectedReasonId) return;
    startTransition(async () => {
      const result = await markLeadAsLost(lead.id, selectedReasonId, lossNotes.trim() || undefined);
      if (result.success) {
        if (scheduleEnabled && scheduleDate && scheduleCadenceId) {
          const schedResult = await scheduleNewProspection(
            lead.id,
            scheduleCadenceId,
            scheduleDate.toISOString(),
          );
          if (schedResult.success) {
            toast.success(`Prospecção agendada para ${format(scheduleDate, 'dd/MM/yyyy')}`);
          } else {
            toast.error(schedResult.error);
          }
        } else {
          toast.success('Lead marcado como perdido');
        }
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
    setShowLostDialog(false);
  }, [lead.id, selectedReasonId, lossNotes, scheduleEnabled, scheduleDate, scheduleCadenceId, router]);

  const loadStages = useCallback(async (provider: CrmProvider, pipelineId: string) => {
    setLoadingStages(true);
    setStages([]);
    setSelectedStageId(null);
    const result = await fetchPipelineStages(provider, pipelineId);
    setLoadingStages(false);
    if (result.success) {
      setStages(result.data);
      if (result.data.length === 1) {
        setSelectedStageId(result.data[0]!.id);
      }
    } else {
      toast.error(result.error);
    }
  }, []);

  const handleOpenWonDialog = useCallback(async () => {
    setShowWonDialog(true);
    setSendToCrm(false);
    setSelectedProvider(null);
    setSelectedPipelineId(null);
    setSelectedStageId(null);
    setStages([]);
    setCrmConnections([]);
    setWonMissingFields([]);
    setWonFieldValues({});
    setLoadingPipelines(true);
    setLoadingRequiredFields(true);

    const [pipelinesResult, stdSettingsResult] = await Promise.all([
      fetchCrmPipelines(),
      listStandardFieldSettingsForMember(),
    ]);

    setLoadingPipelines(false);
    if (pipelinesResult.success && pipelinesResult.data.connections.length > 0) {
      setCrmConnections(pipelinesResult.data.connections);
      const firstConn = pipelinesResult.data.connections[0]!;
      setSelectedProvider(firstConn.provider);
      setSendToCrm(true);
      if (firstConn.pipelines.length === 1) {
        const pipeline = firstConn.pipelines[0]!;
        setSelectedPipelineId(pipeline.id);
        void loadStages(firstConn.provider, pipeline.id);
      }
    }

    if (stdSettingsResult.success) {
      const missing = getMissingRequiredFields(lead, customFieldDefs ?? [], stdSettingsResult.data, 'won');
      setWonMissingFields(missing);
    }
    setLoadingRequiredFields(false);
  }, [loadStages, lead, customFieldDefs]);

  const handleConfirmWon = useCallback(() => {
    startTransition(async () => {
      // Save required field values before marking as won
      if (wonMissingFields.length > 0 && Object.keys(wonFieldValues).length > 0) {
        const standardUpdates: Record<string, unknown> = {};
        const customUpdates: Record<string, string> = {};

        for (const field of wonMissingFields) {
          const value = wonFieldValues[field.key];
          if (!value) continue;
          if (field.isCustom) {
            customUpdates[field.key] = value;
          } else {
            standardUpdates[field.key] = value;
          }
        }

        const updates: Record<string, unknown> = { ...standardUpdates };
        if (Object.keys(customUpdates).length > 0) {
          updates.custom_field_values = {
            ...(lead.custom_field_values ?? {}),
            ...customUpdates,
          };
        }

        if (Object.keys(updates).length > 0) {
          const updateResult = await updateLead(lead.id, updates);
          if (!updateResult.success) {
            toast.error(updateResult.error);
            return;
          }
        }
      }

      const crmOptions = sendToCrm && selectedProvider && selectedPipelineId && selectedStageId
        ? { provider: selectedProvider, pipelineId: selectedPipelineId, stageId: selectedStageId }
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
  }, [lead.id, sendToCrm, selectedProvider, selectedPipelineId, selectedStageId, router, wonMissingFields, wonFieldValues, lead.custom_field_values]);

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
        <LeadDetailSidebar lead={lead} enrollmentData={enrollmentData} timeline={timeline} customFieldDefs={customFieldDefs} leadSourceOptions={leadSourceOptions} />
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
        <DialogContent className="sm:max-w-lg">
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

            {/* Schedule new prospection */}
            <div className="space-y-3 rounded-lg border border-[var(--border)] p-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="schedule-toggle" className="text-sm font-semibold cursor-pointer">
                  Agendar nova prospecção
                </Label>
                <Switch
                  id="schedule-toggle"
                  checked={scheduleEnabled}
                  onCheckedChange={setScheduleEnabled}
                />
              </div>

              {scheduleEnabled && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[var(--muted-foreground)]">Data de início</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className="w-full justify-start text-left font-normal"
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {scheduleDate
                              ? format(scheduleDate, 'dd/MM/yyyy')
                              : 'Selecionar data'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={scheduleDate}
                            onSelect={setScheduleDate}
                            disabled={(date) => date < new Date()}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[var(--muted-foreground)]">Cadência</Label>
                      <Select
                        value={scheduleCadenceId ?? undefined}
                        onValueChange={setScheduleCadenceId}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecionar cadência" />
                        </SelectTrigger>
                        <SelectContent>
                          {cadences.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Uma nova prospecção será iniciada na data e cadência especificada e você permanecerá como o responsável pelo lead.
                  </p>
                </>
              )}
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setShowLostDialog(false)}>
              Fechar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmLost}
              disabled={!selectedReasonId || isPending || (scheduleEnabled && (!scheduleDate || !scheduleCadenceId))}
            >
              Marcar como perdido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Won dialog */}
      <Dialog open={showWonDialog} onOpenChange={setShowWonDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">Marcar lead como ganho</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            {loadingPipelines ? (
              <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Carregando funis do CRM...</p>
            ) : crmConnections.length > 0 ? (
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
                    Enviar ao CRM
                  </Label>
                </div>
                {sendToCrm && (
                  <>
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">CRM</Label>
                      {crmConnections.length > 1 ? (
                        <Select
                          value={selectedProvider ?? undefined}
                          onValueChange={(value) => {
                            const provider = value as CrmProvider;
                            setSelectedProvider(provider);
                            setSelectedPipelineId(null);
                            setSelectedStageId(null);
                            setStages([]);
                            const conn = crmConnections.find((c) => c.provider === provider);
                            if (conn?.pipelines.length === 1) {
                              const pipeline = conn.pipelines[0]!;
                              setSelectedPipelineId(pipeline.id);
                              void loadStages(provider, pipeline.id);
                            }
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Selecione o CRM" />
                          </SelectTrigger>
                          <SelectContent>
                            {crmConnections.map((conn) => (
                              <SelectItem key={conn.provider} value={conn.provider}>
                                {({ pipedrive: 'Pipedrive', hubspot: 'HubSpot', rdstation: 'RD Station', kommo: 'KommoCRM' } as Record<string, string>)[conn.provider] ?? conn.provider}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : selectedProvider && (
                        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                          {({ pipedrive: 'Pipedrive', hubspot: 'HubSpot', rdstation: 'RD Station', kommo: 'KommoCRM' } as Record<string, string>)[selectedProvider] ?? selectedProvider}
                        </p>
                      )}
                    </div>
                    {selectedProvider && (
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold">Funil</Label>
                        <Select
                          value={selectedPipelineId ?? undefined}
                          onValueChange={(value) => {
                            setSelectedPipelineId(value);
                            setSelectedStageId(null);
                            if (selectedProvider) {
                              void loadStages(selectedProvider, value);
                            }
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Selecione o funil" />
                          </SelectTrigger>
                          <SelectContent>
                            {crmConnections
                              .find((c) => c.provider === selectedProvider)
                              ?.pipelines.map((pipeline) => (
                                <SelectItem key={pipeline.id} value={pipeline.id}>
                                  {pipeline.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {selectedPipelineId && (
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold">Etapa</Label>
                        {loadingStages ? (
                          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Carregando etapas...</p>
                        ) : (
                          <Select
                            value={selectedStageId ?? undefined}
                            onValueChange={setSelectedStageId}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Selecione a etapa" />
                            </SelectTrigger>
                            <SelectContent>
                              {stages.map((stage) => (
                                <SelectItem key={stage.id} value={stage.id}>
                                  {stage.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                {'Nenhum CRM conectado. O lead será marcado como ganho sem enviar ao CRM.'}
              </p>
            )}

            {/* Required fields */}
            {loadingRequiredFields ? (
              <p className="text-sm text-[var(--muted-foreground)]">Verificando campos obrigatórios...</p>
            ) : wonMissingFields.length > 0 && (
              <div className="space-y-3 rounded-lg border border-[var(--border)] p-4">
                <p className="text-sm font-semibold">Preencha os campos obrigatórios</p>
                {wonMissingFields.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="text-xs text-[var(--muted-foreground)]">{field.label}</Label>
                    {field.fieldType === 'select' && field.options ? (
                      <Select
                        value={wonFieldValues[field.key] ?? ''}
                        onValueChange={(value) => setWonFieldValues((prev) => ({ ...prev, [field.key]: value }))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={`Selecione ${field.label.toLowerCase()}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {field.options.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : field.fieldType === 'date' ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start text-left font-normal">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {wonFieldValues[field.key]
                              ? format(new Date(wonFieldValues[field.key]!), 'dd/MM/yyyy')
                              : `Selecione ${field.label.toLowerCase()}`}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={wonFieldValues[field.key] ? new Date(wonFieldValues[field.key]!) : undefined}
                            onSelect={(date) => setWonFieldValues((prev) => ({
                              ...prev,
                              [field.key]: date ? date.toISOString().split('T')[0]! : '',
                            }))}
                          />
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <Input
                        type={field.fieldType === 'number' ? 'number' : 'text'}
                        placeholder={field.label}
                        value={wonFieldValues[field.key] ?? ''}
                        onChange={(e) => setWonFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setShowWonDialog(false)}>
              Cancelar
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={handleConfirmWon}
              disabled={
                isPending
                || (sendToCrm && (!selectedPipelineId || !selectedStageId))
                || loadingRequiredFields
                || wonMissingFields.some((f) => !wonFieldValues[f.key]?.trim())
              }
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
