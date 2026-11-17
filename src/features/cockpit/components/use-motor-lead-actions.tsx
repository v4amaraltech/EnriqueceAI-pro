'use client';

import { useState, type ReactNode } from 'react';

import { toast } from 'sonner';

import { MarkLeadLostDialog } from '@/features/leads/components/MarkLeadLostDialog';

import { callNoteKey, readCallNote } from '../utils/call-note-draft';

import {
  CallMeetingConfirmDialog,
  CallMeetingWeekDialog,
  type MeetingChoice,
  type SchedulingPreview,
} from './CallMeetingDialogs';
import { MotorCallbackDialog, type ScheduleCallbackFn } from './MotorCallbackDialog';

const SIMULATED_NOTICE = 'Simulado: nada é registrado.';
const LOST_TITLE = 'Mudar motivo de perda';
const LOST_DESCRIPTION = 'O lead já está perdido: escolha o novo motivo.';
const FIXTURE_NOTICE = 'Fixture de teste: nada é registrado.';

interface UseMotorLeadActionsInput {
  leadId: string;
  leadName: string;
  leadEmail: string | null;
  simulated: boolean;
  /** Fixture visual: não cria reunião nem marca lead como perdido. */
  previewOnly?: boolean;
  schedulingPreview?: SchedulingPreview;
  /** O SDR agendou reunião ou desqualificou o lead: vale como desfecho e a discagem segue (`concludeExternally`). */
  onLeadActed?: (kind: 'scheduled' | 'lost') => void;
  /** "Ligar depois": agenda o retorno e confirma o desfecho (um só caminho, da discagem). Ausente (fixture): só avisa. */
  scheduleCallback?: ScheduleCallbackFn;
  /** Ligações do lead hoje, contando a atual. */
  attemptsToday?: number;
  /** Lead já perdido: o diálogo de motivo vira "Mudar motivo de perda". */
  alreadyLost?: boolean;
  /** Texto atual da anotação do painel (observação inicial do "Ligar depois"). Ausente: lê o rascunho guardado do lead. */
  getNotes?: () => string;
}

/**
 * As três ações do lead que conversou (Agendar reunião, Ligar depois, Desqualificar) e os diálogos delas.
 * Mesma lógica que ficava no painel do lead: `dialogs` precisa ser renderizado junto dos botões.
 */
export type MotorLeadActions = ReturnType<typeof useMotorLeadActions>;

export function useMotorLeadActions({
  leadId,
  leadName,
  leadEmail,
  simulated,
  previewOnly = false,
  schedulingPreview,
  onLeadActed,
  scheduleCallback,
  attemptsToday = 0,
  alreadyLost = false,
  getNotes,
}: UseMotorLeadActionsInput) {
  const [weekOpen, setWeekOpen] = useState(false);
  const [weekSession, setWeekSession] = useState(0);
  const [choice, setChoice] = useState<MeetingChoice | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [callbackNotes, setCallbackNotes] = useState('');
  const [callbackBusy, setCallbackBusy] = useState(false);

  // Trocou de lead: diálogos abertos do lead anterior não podem agir sobre o novo (a instância vive na tela da discagem).
  const [trackedLeadId, setTrackedLeadId] = useState(leadId);
  if (trackedLeadId !== leadId) {
    setTrackedLeadId(leadId);
    setWeekOpen(false);
    setChoice(null);
    setLostOpen(false);
    setCallbackOpen(false);
  }

  function schedule() {
    // Simulado grava nada: sem agenda real (a fixture /demo usa `previewOnly` + `schedulingPreview`).
    if (simulated && !previewOnly) {
      toast.message(SIMULATED_NOTICE);
      return;
    }
    setWeekSession((n) => n + 1);
    setWeekOpen(true);
  }

  function callback() {
    // A anotação do painel do lead (rascunho) entra como observação inicial.
    setCallbackNotes(getNotes ? getNotes() : readCallNote(callNoteKey('motor', leadId)));
    setCallbackOpen(true);
  }

  function disqualify() {
    if (previewOnly) toast.message(FIXTURE_NOTICE);
    else if (simulated) toast.message(SIMULATED_NOTICE);
    else setLostOpen(true);
  }

  const trackedCallback: ScheduleCallbackFn | undefined = scheduleCallback
    ? async (input) => {
        setCallbackBusy(true);
        try {
          return await scheduleCallback(input);
        } finally {
          setCallbackBusy(false);
        }
      }
    : undefined;

  const dialogs: ReactNode = (
    <>
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
          leadId={leadId}
          leadName={leadName}
          leadEmail={leadEmail}
          preview={schedulingPreview}
          onOpenChange={(next) => {
            if (!next) setChoice(null);
          }}
          onScheduled={() => {
            setChoice(null);
            onLeadActed?.('scheduled');
          }}
        />
      )}
      <MotorCallbackDialog
        open={callbackOpen}
        onOpenChange={setCallbackOpen}
        scheduleCallback={trackedCallback}
        attemptsToday={attemptsToday}
        simulated={simulated}
        initialNotes={callbackNotes}
        leadName={leadName}
      />
      <MarkLeadLostDialog
        leadId={leadId}
        open={lostOpen}
        onOpenChange={setLostOpen}
        {...(alreadyLost ? { title: LOST_TITLE, description: LOST_DESCRIPTION } : {})}
        onSuccess={() => {
          setLostOpen(false);
          onLeadActed?.('lost');
        }}
      />
    </>
  );

  return { schedule, callback, disqualify, callbackBusy, dialogs };
}
