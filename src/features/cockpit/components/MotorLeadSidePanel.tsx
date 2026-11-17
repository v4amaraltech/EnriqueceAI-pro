'use client';

import { useState } from 'react';

import { PhoneCall, XIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Textarea } from '@/shared/components/ui/textarea';
import { MarkLeadLostDialog } from '@/features/leads/components/MarkLeadLostDialog';

import type { AutoDialLeadCardExtras } from '../auto-dial.types';
import type { NextCallCardData } from '../types';
import { callNoteKey, readCallNote, writeCallNote } from '../utils/call-note-draft';
import { AUTO_DIAL_RULES } from '../utils/auto-dial-rules';
import { formatLostAgo } from '../utils/lead-card';
import { leadCardFromCallContext } from '../utils/lead-card-from-context';

import { CallHistoryList } from './CallHistoryList';
import { CallLeadCard } from './CallLeadCard';
import {
  CallMeetingConfirmDialog,
  CallMeetingWeekDialog,
  type MeetingChoice,
  type SchedulingPreview,
} from './CallMeetingDialogs';
import { MotorCallbackDialog, type ScheduleCallbackFn } from './MotorCallbackDialog';
import { useLeadHistory } from './use-lead-history';

const STATUS_LABEL: Record<string, string> = {
  new: 'Novo',
  contacted: 'Contatado',
  qualified: 'Qualificado',
  won: 'Ganho',
  unqualified: 'Não qualificado',
  archived: 'Arquivado',
};

const SIMULATED_NOTICE = 'Simulado: nada é registrado.';

interface MotorLeadSidePanelProps {
  card: NextCallCardData;
  /** Tentativa do dia deste lead (a do hook); alimenta "TENTATIVA n/3". */
  attemptNo: number | null;
  /** Flag `call_lead_card_v1`. Desligada: lista simples de fatos. */
  leadCardEnabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Origem, cadastro, último SDR e perda do lead (servidor). Nulo/ausente: nada disso aparece. */
  extras?: AutoDialLeadCardExtras | null;
  /** Estado da ligação do motor, no lugar da linha do telefone ("Em ligação"). Sem botão de discar. */
  statusLine: string;
  simulated: boolean;
  /** Agendar reunião / Desqualificar ficam desligados enquanto a ligação está no ar (igual ao painel da aba Tarefas). */
  actionsDisabled: boolean;
  /** Fixture visual: não cria reunião nem marca lead como perdido. */
  previewOnly?: boolean;
  schedulingPreview?: SchedulingPreview;
  /** O SDR agendou reunião ou desqualificou o lead pelo painel: vale como desfecho e o motor segue (`concludeExternally`). */
  onLeadActed?: (kind: 'scheduled' | 'lost') => void;
  /** "Ligar depois": agenda o retorno e confirma o desfecho (um só caminho, do motor). Ausente (fixture): só avisa. */
  scheduleCallback?: ScheduleCallbackFn;
  /** Ligações do lead hoje, contando a atual (o `attemptNo` do motor); 0 se desconhecido. */
  attemptsToday?: number;
}

/**
 * Painel do lead SOMENTE LEITURA do motor automático: dados do lead que o motor está ligando. Não tem discador,
 * webphone nem botão de ligar/desligar (quem liga é só o motor). É um bloco DOCADO no fluxo da página (a página o
 * põe numa segunda coluna), nunca uma gaveta por cima: assim a confirmação do desfecho e a barra do motor não ficam
 * cobertas. Fechado (`open=false`) não desenha nada, mas os diálogos de agenda/perda seguem montados. As anotações
 * têm rascunho próprio, separado da observação do desfecho.
 */
export function MotorLeadSidePanel({
  card,
  attemptNo,
  extras,
  leadCardEnabled,
  open,
  onOpenChange,
  statusLine,
  simulated,
  actionsDisabled,
  previewOnly = false,
  schedulingPreview,
  onLeadActed,
  scheduleCallback,
  attemptsToday = 0,
}: MotorLeadSidePanelProps) {
  const ctx = card.context;
  const now = new Date(card.generatedAt);
  const noteKey = callNoteKey('motor', ctx.leadId);
  const [notes, setNotes] = useState(() => readCallNote(noteKey));
  const timeline = useLeadHistory(ctx.leadId);
  const [weekOpen, setWeekOpen] = useState(false);
  const [weekSession, setWeekSession] = useState(0);
  const [choice, setChoice] = useState<MeetingChoice | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const [callbackOpen, setCallbackOpen] = useState(false);
  const model = leadCardEnabled ? leadCardFromCallContext(ctx, attemptNo, now, extras) : null;
  const contact = ctx.decisionMaker.name ?? 'Sem contato';
  // Lead perdido: o SDR usa só desfecho e nota; "Desqualificar" some.
  const isLost = ctx.company.status === 'unqualified';
  const lostAgo = formatLostAgo(extras?.lostAt, now);
  const hasLossBlock = Boolean(extras?.lossReasonName?.trim() || extras?.lossNotes?.trim() || lostAgo);

  function updateNotes(value: string) {
    setNotes(value);
    writeCallNote(noteKey, value);
  }

  const facts: Array<[string, string]> = [
    ['Decisor', ctx.decisionMaker.name ?? 'sem dado'],
    ['Cargo', ctx.decisionMaker.jobTitle ?? 'sem dado'],
    ['Telefone', ctx.decisionMaker.phone ?? 'sem dado'],
    ['E-mail', ctx.decisionMaker.email ?? 'sem dado'],
    ['Etapa', STATUS_LABEL[ctx.company.status] ?? ctx.company.status],
    ['Segmento', ctx.company.segmento ?? 'sem dado'],
    ['Porte', ctx.company.porte ?? 'sem dado'],
    ['CNPJ', ctx.company.cnpj ?? 'sem dado'],
  ];

  const closeButton = (
    <Button type="button" size="icon" variant="ghost" className="absolute top-3 right-3 h-7 w-7" aria-label="Fechar painel do lead" onClick={() => onOpenChange(false)}>
      <XIcon className="h-4 w-4" />
    </Button>
  );

  const content = (
    <>
          <header className="relative border-b px-4 py-3 pr-12">
            <h2 className="truncate text-base font-semibold">{ctx.company.name}</h2>
            <p className="text-muted-foreground truncate text-sm">
              {contact}
              {ctx.decisionMaker.phone ? ` · ${ctx.decisionMaker.phone}` : ''}
            </p>
            {closeButton}
          </header>

          <div className="space-y-1 border-b px-4 py-3" data-testid="motor-lead-status">
            <p className="text-sm font-semibold tabular-nums">{ctx.decisionMaker.phone ?? 'Sem telefone'}</p>
            <div className="flex flex-wrap items-center gap-2">
              <PhoneCall className="text-muted-foreground h-3.5 w-3.5" />
              <p className="text-muted-foreground text-sm" role="status" aria-live="polite" data-testid="motor-lead-status-line">
                {statusLine}
                {attemptNo ? ` · tentativa ${attemptNo}/${AUTO_DIAL_RULES.maxAttemptsPerDay}` : ''}
              </p>
              {simulated ? (
                <Badge variant="outline" className="border-amber-500 font-bold text-amber-600 dark:text-amber-400">
                  SIMULADO
                </Badge>
              ) : (
                <Badge variant="destructive" className="font-bold">
                  LIGAÇÃO REAL
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-xs">Quem liga é a discagem automática. Para encerrar a ligação use o botão Desligar da barra da discagem.</p>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {model ? (
              <CallLeadCard model={model} />
            ) : (
              <>
                <dl className="space-y-1.5 text-xs" data-testid="motor-lead-facts">
                  {facts.map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="break-words">{value}</dd>
                    </div>
                  ))}
                </dl>
                <section data-testid="motor-lead-opening">
                  <h3 className="text-xs font-semibold">Abertura sugerida</h3>
                  <p className="mt-1 text-xs">{card.approach.opening}</p>
                </section>
              </>
            )}

            {hasLossBlock && (
              <section data-testid="motor-lead-loss" className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs">
                <h3 className="text-foreground text-xs font-semibold">Perda anterior</h3>
                {(extras?.lossReasonName?.trim() || lostAgo) && (
                  <p className="mt-1">
                    {[extras?.lossReasonName?.trim(), lostAgo].filter(Boolean).join(' · ')}
                  </p>
                )}
                {extras?.lossNotes?.trim() && <p className="mt-1 whitespace-pre-wrap">{extras.lossNotes.trim()}</p>}
              </section>
            )}

            <details data-testid="motor-lead-history" className="rounded-md border px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold">Histórico</summary>
              <CallHistoryList timeline={timeline} />
            </details>
          </div>

          <div className="mt-auto space-y-2 border-t px-4 py-4">
            <label className="block text-xs font-medium" htmlFor="motor-call-notes">
              Anotações
            </label>
            <Textarea
              id="motor-call-notes"
              value={notes}
              onChange={(event) => updateNotes(event.target.value)}
              placeholder="O que o lead disse. A nota fica guardada se você fechar o painel."
              className="min-h-16 text-xs"
            />
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                className="h-9 w-full"
                disabled={actionsDisabled}
                data-testid="motor-schedule-meeting"
                onClick={() => {
                  // Simulado grava nada: sem agenda real (a fixture /demo usa `previewOnly` + `schedulingPreview`).
                  if (simulated && !previewOnly) {
                    toast.message(SIMULATED_NOTICE);
                    return;
                  }
                  setWeekSession((n) => n + 1);
                  setWeekOpen(true);
                }}
              >
                Agendar reunião
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 w-full"
                disabled={actionsDisabled}
                data-testid="motor-callback-button"
                onClick={() => setCallbackOpen(true)}
              >
                Ligar depois
              </Button>
              {!isLost && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-full"
                  disabled={actionsDisabled}
                  data-testid="motor-disqualify"
                  onClick={
                    previewOnly
                      ? () => toast.message('Fixture de teste: nada é registrado.')
                      : simulated
                        ? () => toast.message(SIMULATED_NOTICE)
                        : () => setLostOpen(true)
                  }
                >
                  Desqualificar
                </Button>
              )}
            </div>
          </div>
    </>
  );

  return (
    <>
    {open && (
      <aside
        data-testid="motor-lead-panel"
        data-slot="motor-lead-panel"
        aria-label="Dados do lead"
        // Estreito: empilha abaixo do cartão. lg+: fica colado ao topo da 2ª coluna, com rolagem interna.
        className="bg-background relative flex max-h-[80vh] w-full flex-col overflow-hidden rounded-lg border shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)]"
      >
        {content}
      </aside>
    )}

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
        leadId={ctx.leadId}
        leadName={ctx.company.name}
        leadEmail={ctx.decisionMaker.email}
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
      scheduleCallback={scheduleCallback}
      attemptsToday={attemptsToday}
      simulated={simulated}
      initialNotes={notes}
      leadName={ctx.company.name}
    />
    <MarkLeadLostDialog
      leadId={ctx.leadId}
      open={lostOpen}
      onOpenChange={setLostOpen}
      onSuccess={() => {
        setLostOpen(false);
        onLeadActed?.('lost');
      }}
    />
    </>
  );
}
