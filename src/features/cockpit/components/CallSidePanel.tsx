'use client';

import { useCallback, useEffect, useState } from 'react';

import { Building2, ChevronDown, Minus, X } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Textarea } from '@/shared/components/ui/textarea';

import { ActivityPhonePanel, type CallState } from '@/features/activities/components/ActivityPhonePanel';
import type { PendingActivity } from '@/features/activities/types';
import { getAllLeadPhones } from '@/features/activities/utils/resolve-whatsapp-phone';
import type { DialerProvider } from '@/features/calls/types/dialer-provider';

import { callNoteKey, readCallNote, writeCallNote } from '../utils/call-note-draft';
import { usefulCallScript, type CallHistoryEntry } from '../utils/call-history';

import { CallMeetingConfirmDialog, CallMeetingWeekDialog, type MeetingChoice, type SchedulingPreview } from './CallMeetingDialogs';
import { useLeadHistory } from './use-lead-history';

const STATUS_LABEL: Record<string, string> = {
  new: 'Novo',
  contacted: 'Contatado',
  qualified: 'Qualificado',
  won: 'Ganho',
  unqualified: 'Não qualificado',
  archived: 'Arquivado',
};

const ENRICHMENT_LABEL: Record<string, string> = {
  pending: 'Pendente',
  enriching: 'Enriquecendo',
  enriched: 'Enriquecido',
  enrichment_failed: 'Falhou',
  not_found: 'Não encontrado',
};

const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

interface CallSidePanelProps {
  activity: PendingActivity;
  dialerProvider?: DialerProvider;
  minimized: boolean;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
  onMarkDone: (notes: string) => void;
  onSkip: () => void;
  onLeadLost: () => void;
  onScheduled: () => void;
  onCallStateChange?: (state: CallState) => void;
  history?: CallHistoryEntry[];
  schedulingPreview?: SchedulingPreview;
  /** Fixture visual: não origina ligação nem abre diálogos que gravam lead. */
  previewOnly?: boolean;
}

export function CallSidePanel({
  activity,
  dialerProvider,
  minimized,
  onMinimize,
  onRestore,
  onClose,
  onMarkDone,
  onSkip,
  onLeadLost,
  onScheduled,
  onCallStateChange,
  history,
  schedulingPreview,
  previewOnly = false,
}: CallSidePanelProps) {
  const lead = activity.lead;
  const company = lead.nome_fantasia ?? lead.razao_social ?? lead.cnpj;
  const contact = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Sem contato';
  const noteKey = callNoteKey(activity.enrollmentId, activity.stepId);
  const [notes, setNotes] = useState(() => readCallNote(noteKey));
  const [callState, setCallState] = useState<CallState>('idle');
  const [weekOpen, setWeekOpen] = useState(false);
  const [weekSession, setWeekSession] = useState(0);
  const [choice, setChoice] = useState<MeetingChoice | null>(null);
  const script = usefulCallScript(activity.callScript);
  const timeline = useLeadHistory(lead.id, history);
  const inCall = callState === 'calling' || callState === 'connected';

  useEffect(() => {
    setNotes(readCallNote(noteKey));
  }, [noteKey]);

  const handleState = useCallback((state: CallState) => {
    setCallState(state);
    onCallStateChange?.(state);
  }, [onCallStateChange]);

  function updateNotes(value: string) {
    setNotes(value);
    writeCallNote(noteKey, value);
  }

  function requestClose() {
    if (inCall) return;
    onClose();
  }

  const resolvedEmail = (lead.socios ?? []).flatMap((socio) => socio.emails ?? []).sort((a, b) => a.ranking - b.ranking)[0]?.email ?? lead.email;
  const dayLabel = activity.stepDay ? `Dia ${activity.stepDay}` : null;
  const facts = [
    ['Origem', [lead.lead_source, lead.canal].filter(Boolean).join(' · ') || 'sem origem'],
    ['Etapa', lead.status ? (STATUS_LABEL[lead.status] ?? lead.status) : 'sem etapa'],
    ['Cadência', [activity.cadenceName, dayLabel, `tarefa ${activity.stepOrder}/${activity.totalSteps}`].filter(Boolean).join(' · ')],
    ['Enriquecimento', lead.enrichment_status ? (ENRICHMENT_LABEL[lead.enrichment_status] ?? lead.enrichment_status) : 'sem dado'],
    ['Segmento', lead.segmento || 'sem dado'],
    ['Porte', lead.porte || 'sem dado'],
    ['E-mail', resolvedEmail || 'sem dado'],
    ['Site', lead.website || 'sem dado'],
  ];

  return (
    <aside
      data-testid="call-side-panel"
      aria-label="Contexto da ligação"
      className={cn(
        'border-border bg-card z-30 flex w-full flex-col rounded-lg border shadow-sm md:sticky md:top-4 md:w-[320px] md:max-h-[calc(100vh-2rem)]',
        minimized ? 'h-14' : 'max-h-[78vh] md:max-h-[calc(100vh-2rem)]',
      )}
    >
      <header className="flex items-start gap-2 border-b px-3 py-2">
        <Building2 className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{company}</p>
          <p className="text-muted-foreground truncate text-xs">{contact}{lead.telefone ? ` · ${lead.telefone}` : ''}</p>
        </div>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={minimized ? 'Restaurar painel' : 'Minimizar painel'} onClick={minimized ? onRestore : onMinimize}>
          {minimized ? <ChevronDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Fechar painel" onClick={requestClose} disabled={inCall} title={inCall ? 'Encerre a ligação antes de fechar' : 'Fechar'}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className={cn('flex min-h-0 flex-1 flex-col', minimized && 'hidden')}>
        <div className="border-b px-3 py-2">
          <ActivityPhonePanel
            layout="dock"
            leadName={company}
            leadId={lead.id}
            leadEmail={resolvedEmail}
            leadFirstName={lead.primeiro_nome ?? lead.first_name}
            phoneNumber={lead.telefone}
            phones={getAllLeadPhones(lead)}
            isSending={false}
            onMarkDone={onMarkDone}
            onSkip={onSkip}
            onLeadLost={onLeadLost}
            canMarkNoShow={Boolean(lead.meeting_scheduled_at)}
            dialerProvider={dialerProvider}
            companionNotes={notes}
            onCallStateChange={handleState}
            callsDisabled={previewOnly}
            cadenceStep={activity.enrollmentId.startsWith('scheduled:') ? undefined : { enrollmentId: activity.enrollmentId, stepId: activity.stepId }}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          <dl className="space-y-1.5 text-xs">
            {facts.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="truncate">{value}</dd>
              </div>
            ))}
          </dl>

          {script && (
            <section>
              <h3 className="text-xs font-semibold">Contexto do passo</h3>
              <p className="mt-1 whitespace-pre-wrap text-xs">{script}</p>
            </section>
          )}

          <section aria-label="Histórico de contatos">
            <h3 className="text-xs font-semibold">Histórico</h3>
            {timeline.status === 'loading' && <p className="text-muted-foreground mt-1 text-xs">Carregando histórico...</p>}
            {timeline.status === 'error' && <p className="mt-1 text-xs text-amber-700">Não foi possível carregar o histórico.</p>}
            {timeline.status === 'ready' && timeline.entries.length === 0 && (
              <p className="text-muted-foreground mt-1 text-xs">Nenhum contato registrado ainda.</p>
            )}
            {timeline.status === 'ready' && timeline.entries.length > 0 && (
              <ol className="mt-2 space-y-2">
                {timeline.entries.map((entry) => (
                  <li key={entry.id} className="border-l-2 border-primary/40 pl-2">
                    <p className="text-[11px] font-medium">{entry.title}</p>
                    <p className="text-muted-foreground text-[10px]">{timeFmt.format(new Date(entry.at))}</p>
                    {entry.detail && <p className="text-xs">{entry.detail}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="space-y-2 border-t px-3 py-2">
          <label className="block text-xs font-medium" htmlFor="call-notes">Anotações</label>
          <Textarea
            id="call-notes"
            value={notes}
            onChange={(event) => updateNotes(event.target.value)}
            placeholder="O que o lead disse. A nota fica nesta tarefa se você fechar o painel."
            className="min-h-16 text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="flex-1" onClick={() => { setWeekSession((session) => session + 1); setWeekOpen(true); }} disabled={inCall}>
              Agendar reunião
            </Button>
            <Button type="button" variant="outline" onClick={previewOnly ? () => toast.message('Fixture de teste: nada é registrado.') : onLeadLost} disabled={inCall}>
              Desqualificar
            </Button>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={previewOnly ? () => toast.message('Fixture de teste: nada é registrado.') : onSkip} disabled={inCall}>
              Adiar
            </Button>
            <Button type="button" variant="outline" className="flex-1 text-emerald-700" onClick={previewOnly ? () => toast.message('Fixture de teste: nada é registrado.') : () => onMarkDone(notes)} disabled={inCall}>
              Concluir
            </Button>
          </div>
        </div>
      </div>

      <CallMeetingWeekDialog
        key={weekSession}
        open={weekOpen}
        onOpenChange={setWeekOpen}
        preview={schedulingPreview}
        onChoose={(next) => {
          setChoice(next);
          setWeekOpen(false);
        }}
      />
      {choice && (
      <CallMeetingConfirmDialog
        key={`${choice.start.toISOString()}:${choice.closer.id}`}
        open
        choice={choice}
        leadId={lead.id}
        leadName={company}
        leadEmail={resolvedEmail}
        preview={schedulingPreview}
        onOpenChange={(open) => {
          if (!open) setChoice(null);
        }}
        onScheduled={onScheduled}
      />
      )}
    </aside>
  );
}
