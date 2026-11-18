'use client';

import { useState } from 'react';

import { PhoneCall, XIcon } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Textarea } from '@/shared/components/ui/textarea';

import type { AutoDialLeadCardExtras } from '../auto-dial.types';
import type { NextCallCardData } from '../types';
import { callNoteKey, readCallNote, writeCallNote } from '../utils/call-note-draft';
import { AUTO_DIAL_RULES } from '../utils/auto-dial-rules';
import { formatLostAgo } from '../utils/lead-card';
import { leadCardFromCallContext } from '../utils/lead-card-from-context';

import { CallHistoryList } from './CallHistoryList';
import { CallLeadCard } from './CallLeadCard';
import { LeadQuickActions } from './LeadQuickActions';
import { RecoveryTag, showsRecoveryTag } from './RecoveryTag';
import { useLeadHistory } from './use-lead-history';
import type { MotorLeadActions } from './use-motor-lead-actions';
import type { MotorNoteStatus, MotorPanelNote } from '../hooks/use-motor-panel-note';

const STATUS_LABEL: Record<string, string> = {
  new: 'Novo',
  contacted: 'Contatado',
  qualified: 'Qualificado',
  won: 'Ganho',
  unqualified: 'Não qualificado',
  archived: 'Arquivado',
};

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
  /** Instância única das ações do lead (a da tela da discagem). Ausente: o painel fica só de leitura. */
  actions?: MotorLeadActions;
  /** Fila do motor: na 'recovery' (ou lead perdido) o cabeçalho mostra a etiqueta "Recuperação · Perdido: <motivo>". */
  queue?: string;
  /** Anotação que GRAVA na ligação (estado vem da tela da discagem). Ausente: rascunho local, sem gravar. */
  note?: MotorPanelNote;
}

/**
 * Painel do lead do motor automático: dados do lead que o motor está ligando e, numa faixa fixa acima das Anotações, as
 * três ações (Agendar reunião, Ligar depois, Desqualificar) em qualquer fase. Não tem discador, webphone nem botão de
 * ligar/desligar (quem liga é só o motor). É um bloco DOCADO no fluxo da página (a página o
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
  actions,
  queue = 'normal',
  note,
}: MotorLeadSidePanelProps) {
  const ctx = card.context;
  const now = new Date(card.generatedAt);
  const noteKey = callNoteKey('motor', ctx.leadId);
  const [notes, setNotes] = useState(() => readCallNote(noteKey));
  const timeline = useLeadHistory(ctx.leadId);
  const model = leadCardEnabled ? leadCardFromCallContext(ctx, attemptNo, now, extras) : null;
  const contact = ctx.decisionMaker.name ?? 'Sem contato';
  const lostAgo = formatLostAgo(extras?.lostAt, now);
  const hasLossBlock = Boolean(extras?.lossReasonName?.trim() || extras?.lossNotes?.trim() || lostAgo);

  function updateNotes(value: string) {
    if (note) {
      note.onChange(value);
      return;
    }
    setNotes(value);
    writeCallNote(noteKey, value);
  }
  const noteValue = note ? note.value : notes;

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
            {showsRecoveryTag({ queue, status: ctx.company.status }) && (
              <div className="mt-1.5">
                <RecoveryTag reason={extras?.lossReasonName} />
              </div>
            )}
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

          <div className="mt-auto space-y-3 border-t px-4 py-3">
            {actions && <LeadQuickActions status={ctx.company.status} actions={actions} simulated={simulated} />}
            <label className="block text-xs font-medium" htmlFor="motor-call-notes">
              Anotações
            </label>
            <Textarea
              id="motor-call-notes"
              value={noteValue}
              onChange={(event) => updateNotes(event.target.value)}
              onBlur={note ? note.onBlur : undefined}
              placeholder={note ? 'O que o lead disse. Grava na ligação ao sair do campo.' : 'O que o lead disse. A nota fica guardada se você fechar o painel.'}
              className="min-h-16 text-xs"
            />
            {note && <NoteStatusLine status={note.status} onRetry={note.retry} />}
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
    </>
  );
}

const NOTE_STATUS_TEXT: Record<Exclude<MotorNoteStatus['kind'], 'error'>, string> = {
  idle: 'Esta anotação é a que vale: grava na ligação ao sair do campo.',
  simulated: 'Simulado: a anotação não é gravada.',
  waiting: 'Discando: a anotação grava assim que a ligação existir.',
  'no-call': 'A ligação deste lead não foi criada: a anotação fica guardada aqui, mas NÃO foi gravada.',
  saving: 'Gravando…',
  saved: 'Guardada na ligação',
};

function NoteStatusLine({ status, onRetry }: { status: MotorNoteStatus; onRetry: () => void }) {
  if (status.kind === 'error') {
    return (
      <p className="text-destructive text-[11px]" role="alert" data-testid="motor-note-status">
        Não gravou: {status.message}{' '}
        <button type="button" className="underline underline-offset-2" onClick={onRetry} data-testid="motor-note-retry">
          Tentar de novo
        </button>
      </p>
    );
  }
  return (
    <p className="text-muted-foreground text-[11px]" role="status" aria-live="polite" data-testid="motor-note-status" data-kind={status.kind}>
      {NOTE_STATUS_TEXT[status.kind]}
    </p>
  );
}
