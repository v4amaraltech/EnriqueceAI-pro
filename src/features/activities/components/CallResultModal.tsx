'use client';

import { useState } from 'react';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CalendarIcon,
  CalendarX,
  CheckCircle2,
  FileText,
  Loader2,
  PhoneCall,
  PhoneMissed,
  ThumbsDown,
} from 'lucide-react';

import { CallOutcomeSelector } from '@/features/calls/components/CallOutcomeSelector';
import { CONNECTED_MIN_DURATION_SECONDS } from '@/features/calls/connection';
import {
  DISPOSITION_REPORT_LABELS,
  dispositionOptionsForTelemetry,
  mapDispositionToAction,
} from '@/features/calls/disposition';
import type { PostCallSuggestion } from '@/features/calls/post-call-suggestion';
import type { CallDisposition } from '@/features/calls/types';
import { ScheduleMeetingModal } from '@/features/integrations/components/ScheduleMeetingModal';
import { nextActivityLabel } from '@/features/integrations/webphone/LiveAmdHint';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils/format';
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
import { Label } from '@/shared/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Textarea } from '@/shared/components/ui/textarea';

export interface CallReturnSchedule {
  scheduledAt: string;
  channel: 'phone' | 'whatsapp' | 'email';
  /** 'whatsapp' quando o retorno é uma Ligação via WhatsApp (channel='phone'); senão null. */
  callProvider: 'whatsapp' | null;
}

/** Valor do dropdown "Canal" — "whatsapp_call" mapeia p/ phone + callProvider. */
type ReturnChannelOption = 'phone' | 'whatsapp' | 'whatsapp_call' | 'email';

const RETURN_CHANNEL_MAP: Record<
  ReturnChannelOption,
  { channel: CallReturnSchedule['channel']; callProvider: 'whatsapp' | null }
> = {
  phone: { channel: 'phone', callProvider: null },
  whatsapp: { channel: 'whatsapp', callProvider: null },
  whatsapp_call: { channel: 'phone', callProvider: 'whatsapp' },
  email: { channel: 'email', callProvider: null },
};

/**
 * Desfecho inicial a partir do sinal técnico:
 *  - não atendida → a telemetria já classifica: `no_contact` automático, o SDR
 *    conclui em 1 clique (caso mais comom do dia);
 *  - atendida → `null` (obrigatório): a qualidade da conversa — relevante, sem
 *    avanço, pediu retorno — só o SDR sabe, então ele DEVE escolher antes de
 *    concluir. Sem default silencioso (era `significant` e o SDR aceitava sem
 *    pensar → preenchimento sem valor de métrica).
 */
function defaultOutcome(connected: boolean): CallDisposition | null {
  return connected ? null : 'no_answer';
}

function suggestionIsAllowed(
  connected: boolean,
  disposition: CallDisposition | null,
): CallDisposition | null {
  if (!disposition) return null;
  return dispositionOptionsForTelemetry(connected).some((o) => o.value === disposition)
    ? disposition
    : null;
}

/** Desfecho inicial: preenchimento automático, depois sugestão, depois o sinal técnico. */
function initialOutcome(
  connected: boolean,
  suggestion?: PostCallSuggestion | null,
): CallDisposition | null {
  const filled = suggestion?.alreadyFilledDisposition ?? null;
  if (filled) return suggestionIsAllowed(connected, filled) ?? filled;
  const suggested = suggestionIsAllowed(connected, suggestion?.outcome ?? null);
  if (suggested) return suggested;
  return defaultOutcome(connected);
}

function initialShowOutcome(connected: boolean, suggestion?: PostCallSuggestion | null): boolean {
  if (suggestion?.alreadyFilled) return true;
  if (suggestionIsAllowed(connected, suggestion?.outcome ?? null)) return true;
  return connected;
}

function parsePrefillDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function initialReturnDate(suggestion?: PostCallSuggestion | null): Date | undefined {
  return parsePrefillDate(suggestion?.meetingPrefill?.date);
}

function initialReturnTime(suggestion?: PostCallSuggestion | null): string {
  const time = suggestion?.meetingPrefill?.time?.trim();
  return time && /^\d{2}:\d{2}$/.test(time) ? time : '09:00';
}

function suggestionFingerprint(suggestion?: PostCallSuggestion | null): string {
  if (!suggestion) return '';
  return [
    suggestion.source ?? '',
    suggestion.outcome ?? '',
    suggestion.nextActivity ?? '',
    suggestion.alreadyFilled ? '1' : '0',
    suggestion.alreadyFilledDisposition ?? '',
    suggestion.meetingPrefill?.date ?? '',
    suggestion.meetingPrefill?.time ?? '',
    suggestion.meetingPrefill?.closerId ?? '',
  ].join('|');
}

export interface CallResultModalProps {
  open: boolean;
  onClose: () => void;
  leadName: string;
  /**
   * Aceitos por compatibilidade — os discadores ainda os passam, mas o modal não
   * os usa: o atalho "Agendar Reunião" foi removido (o agendamento passa pelo
   * fluxo próprio, com o briefing do closer). Mantidos opcionais aqui para evitar
   * um refactor em cascata nos painéis e seus callers.
   */
  leadId?: string;
  leadEmail?: string | null;
  leadFirstName?: string | null;
  /** Número exibido no cabeçalho. */
  phoneLabel: string;
  durationSeconds: number;
  /** Sinal técnico de atendimento — pré-seleciona o desfecho e o pill do topo. */
  connected: boolean;
  /**
   * Anotações digitadas em outro lugar durante a ligação (painel flutuante do
   * webphone). Entram no campo quando o modal abre; o SDR pode editar.
   */
  initialNotes?: string;
  /**
   * `false` trava o fechamento acidental: clique fora e Esc não fecham o modal
   * (só "Concluir" ou o × do cabeçalho). O painel flutuante do webphone usa,
   * porque fica visível atrás do modal e um clique nele descartava o resultado
   * sem gravar anotações nem desfecho.
   */
  dismissible?: boolean;
  isSending?: boolean;
  /** Quando presente, mostra "Ligar de novo". Recebe as anotações atuais — o
   *  consumidor registra a tentativa com elas e RE-DISCA na hora (o SDR liga
   *  várias vezes até conectar sem sair do fluxo). */
  onRetry?: (notes: string) => void;
  /** Quando presente, mostra "Perdido". */
  onLeadLost?: () => void;
  /** Quando presente, mostra "No-show". */
  onMarkNoShow?: () => void;
  /**
   * Conclui a atividade. `returnSchedule` != null quando o desfecho reagenda
   * (ocupado / não atendeu) — o consumidor decide encerrar a cadência e criar a
   * atividade de retorno. `outcome` é o desfecho informado pelo SDR.
   */
  onConclude: (args: {
    notes: string;
    returnSchedule: CallReturnSchedule | null;
    outcome: CallDisposition;
  }) => void;
  /**
   * Texto quando a data do retorno já foi escolhida. O cockpit e o WhatsApp
   * pausam a cadência. O painel flutuante, quando ele é o dono, só cria a
   * atividade e por isso passa outra frase.
   */
  returnReadyMessage?: string;
  /** O painel flutuante espelha o texto aqui para não perder a nota se outra ligação começar. */
  onNotesChange?: (notes: string) => void;
  /**
   * Sugestão da IA ou preenchimento automático já feito. Quando presente, o
   * desfecho e a próxima atividade vêm pré-selecionados (ainda editáveis).
   * Se o CRM já foi preenchido (marcador), o SDR só confirma ou segue.
   */
  suggestion?: PostCallSuggestion | null;
}

/**
 * Modal "Resultado da Ligação" — compartilhado entre a ligação normal (API4COM) e
 * a Ligação via WhatsApp. Captura o desfecho do SDR, anotações e o retorno.
 *
 * Não atendida (connected=false): não há o que classificar, então o desfecho
 * fica oculto (fixo em "Não atendeu") e "Ligar de novo" vira a ação primária —
 * o SDR re-disca num clique (comportamento real de tentar 3x até conectar). Um
 * link "Registrar outro desfecho" revela o seletor para casos raros (ex.: falha
 * técnica). Atendida: fluxo completo, "Concluir atividade" primário.
 *
 * A lógica de avanço/persistência/re-discagem fica no consumidor, via callbacks.
 */
export function CallResultModal({
  open,
  onClose,
  leadName,
  leadId,
  leadEmail,
  leadFirstName,
  phoneLabel,
  durationSeconds,
  connected,
  initialNotes = '',
  dismissible = true,
  isSending = false,
  onRetry,
  onLeadLost,
  onMarkNoShow,
  onConclude,
  returnReadyMessage = 'A cadência fica pausada até o retorno e a atividade de retorno é criada.',
  onNotesChange,
  suggestion = null,
}: CallResultModalProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [outcome, setOutcome] = useState<CallDisposition | null>(() =>
    initialOutcome(connected, suggestion),
  );
  const [returnDate, setReturnDate] = useState<Date | undefined>(() =>
    initialReturnDate(suggestion),
  );
  const [returnTime, setReturnTime] = useState(() => initialReturnTime(suggestion));
  const [returnChannel, setReturnChannel] = useState<ReturnChannelOption>('phone');
  const [outcomeTouched, setOutcomeTouched] = useState(false);
  // Atendida → mostra o seletor de desfecho de cara. Não atendida → esconde
  // (o SDR só quer re-discar); revela sob demanda para casos raros.
  const [showOutcome, setShowOutcome] = useState(() => initialShowOutcome(connected, suggestion));

  // O modal não é remontado entre ligações — sem este reset, as anotações e o
  // desfecho da chamada anterior vazariam para a próxima.
  //
  // Ajuste durante o render (padrão oficial do React para "resetar estado quando
  // uma prop muda") em vez de useEffect: o React reexecuta o componente na hora,
  // sem pintar o estado velho e sem render em cascata.
  const [wasOpen, setWasOpen] = useState(open);
  const [wasConnected, setWasConnected] = useState(connected);
  const [wasSuggestion, setWasSuggestion] = useState(suggestionFingerprint(suggestion));
  if (open !== wasOpen) {
    setWasOpen(open);
    setWasConnected(connected);
    setWasSuggestion(suggestionFingerprint(suggestion));
    if (open) {
      setNotes(initialNotes);
      setOutcome(initialOutcome(connected, suggestion));
      setReturnDate(initialReturnDate(suggestion));
      setReturnTime(initialReturnTime(suggestion));
      setReturnChannel('phone');
      setShowOutcome(initialShowOutcome(connected, suggestion));
      setOutcomeTouched(false);
    }
  } else if (open && connected !== wasConnected) {
    // O sinal de atendimento mudou com o modal aberto (o webhook da API4COM
    // chegou depois): reaplica o padrão se o SDR ainda não mexeu no desfecho
    // ou se a escolha dele deixou de valer (ex.: "Conversa relevante" numa
    // ligação que a telefonia diz que ninguém atendeu).
    setWasConnected(connected);
    const untouched =
      !outcomeTouched &&
      outcome === initialOutcome(wasConnected, suggestion) &&
      showOutcome === initialShowOutcome(wasConnected, suggestion);
    const stillValid =
      outcome !== null &&
      dispositionOptionsForTelemetry(connected).some((o) => o.value === outcome);
    if (untouched || !stillValid) {
      setOutcome(initialOutcome(connected, suggestion));
      setShowOutcome(initialShowOutcome(connected, suggestion));
    }
  } else if (open && suggestionFingerprint(suggestion) !== wasSuggestion) {
    // A sugestão ou o marcador chegaram com o modal aberto. Só aplica se o SDR
    // ainda não escolheu um desfecho.
    setWasSuggestion(suggestionFingerprint(suggestion));
    if (!outcomeTouched) {
      setOutcome(initialOutcome(connected, suggestion));
      setShowOutcome(initialShowOutcome(connected, suggestion));
      if (!returnDate) setReturnDate(initialReturnDate(suggestion));
      if (returnTime === '09:00') setReturnTime(initialReturnTime(suggestion));
    }
  }

  const outcomeOptions = dispositionOptionsForTelemetry(connected);
  const action = outcome ? mapDispositionToAction(outcome) : 'none';
  const needsReturn = showOutcome && action === 'reschedule';
  const missingReturnDate = needsReturn && !returnDate;
  // "Ligar de novo" é a ação primária quando ainda não houve contato: não
  // atendida OU caixa postal/secretária (a linha atendeu, mas não um humano —
  // o SDR quase sempre vai tentar de novo).
  const retryPrimary = !connected || outcome === 'voicemail';
  // Atendida obriga o SDR a escolher o desfecho antes de concluir. Na não
  // atendida `outcome` já vem preenchido (no_contact), então nunca bloqueia.
  const missingOutcome = showOutcome && outcome === null;
  const keepsTaskOpen = outcome !== null && mapDispositionToAction(outcome) === 'none';
  // A API4COM marca como atendida também quando a CAIXA POSTAL pega a linha —
  // não há sinal que separe as duas. Abaixo do piso de conversa (50s) o selo
  // avisa em vez de afirmar; o SDR diz o que foi no desfecho.
  const maybeVoicemail = connected && durationSeconds < CONNECTED_MIN_DURATION_SECONDS;

  function buildReturnSchedule(): CallReturnSchedule | null {
    if (!needsReturn || !returnDate) return null;
    const [hours, minutes] = returnTime.split(':').map(Number);
    const scheduledAt = new Date(returnDate);
    scheduledAt.setHours(hours ?? 9, minutes ?? 0, 0, 0);
    return { scheduledAt: scheduledAt.toISOString(), ...RETURN_CHANNEL_MAP[returnChannel] };
  }

  function handleConclude() {
    // Guarda de tipo + trava de obrigatoriedade: sem desfecho não conclui.
    if (!outcome) return;
    onConclude({ notes, returnSchedule: buildReturnSchedule(), outcome });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* `grid-cols-[minmax(0,1fr)]`: o DialogContent é um grid de uma coluna
          `auto`, que cresce até o maior texto sem quebra (o nome do lead com
          `truncate`). Com razão social longa a coluna passava da largura do
          modal e cortava o selo "Atendida/Não atendida" e o "Concluir"
          (22/10/2026). Com mínimo 0 a coluna respeita o modal e o nome trunca. */}
      <DialogContent
        className="grid-cols-[minmax(0,1fr)] sm:max-w-2xl max-h-[90vh] overflow-y-auto"
        onInteractOutside={dismissible ? undefined : (e) => e.preventDefault()}
        onEscapeKeyDown={dismissible ? undefined : (e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Resultado da Ligação</DialogTitle>
          {/* Descrição obrigatória para leitores de tela — sem ela o Radix
              avisa e o usuário de leitor de tela abre o modal sem contexto. */}
          <DialogDescription>
            Registre o que aconteceu na ligação para {leadName} e conclua a atividade.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Resumo — a duração ganha significado no pill de status */}
          <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--muted)] px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{leadName}</p>
              <p className="truncate text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                {phoneLabel}
              </p>
            </div>
            <div
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                connected && !maybeVoicemail
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
              )}
            >
              {connected ? (
                <PhoneCall className="h-3.5 w-3.5" />
              ) : (
                <PhoneMissed className="h-3.5 w-3.5" />
              )}
              <span>
                {maybeVoicemail
                  ? 'Atendida · pode ser caixa postal'
                  : connected
                    ? 'Atendida'
                    : 'Não atendida'}
              </span>
              <span aria-hidden>·</span>
              <span className="font-mono tabular-nums">{formatDuration(durationSeconds)}</span>
            </div>
          </div>

          {/* Desfecho — visível quando atendida (ou revelado sob demanda) */}
          {showOutcome ? (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                O que aconteceu?
              </Label>
              <CallOutcomeSelector
                value={outcome}
                onChange={(value) => {
                  setOutcomeTouched(true);
                  setOutcome(value);
                }}
                options={outcomeOptions}
                disabled={isSending}
              />
              {missingOutcome && (
                <p className="text-xs text-[var(--muted-foreground)]">
                  Selecione o desfecho para concluir a atividade.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">
              Ninguém atendeu. Ligue de novo ou conclua a atividade.{' '}
              <button
                type="button"
                onClick={() => setShowOutcome(true)}
                disabled={isSending}
                className="font-medium text-[var(--primary)] underline-offset-2 hover:underline disabled:opacity-50"
              >
                Registrar outro desfecho
              </button>
            </p>
          )}

          {suggestionBanner(suggestion)}

          {suggestion?.nextActivity === 'schedule_meeting' &&
          outcome === 'relevant_conversation' &&
          leadId ? (
            <div
              className="space-y-2 rounded-lg border border-[var(--border)] p-3"
              data-testid="meeting-prefill"
            >
              <p className="text-xs text-[var(--muted-foreground)]">
                Reunião pré-preenchida com os dados do lead. Os convites só são enviados quando você
                agendar.
              </p>
              <ScheduleMeetingModal
                inline
                open
                onOpenChange={() => undefined}
                leadId={leadId}
                leadEmail={leadEmail}
                leadName={leadName}
                leadFirstName={leadFirstName}
                defaultCloserId={suggestion.meetingPrefill?.closerId ?? undefined}
                defaultDate={suggestion.meetingPrefill?.date ?? undefined}
                defaultTime={suggestion.meetingPrefill?.time ?? undefined}
                defaultDescription={suggestion.reason ?? undefined}
              />
            </div>
          ) : null}

          {/* Retorno — aparece sozinho quando o desfecho reagenda */}
          {needsReturn && (
            <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-center gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  Quando ligar de novo
                </Label>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Canal</Label>
                  <Select
                    value={returnChannel}
                    onValueChange={(v) => setReturnChannel(v as ReturnChannelOption)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="phone">Ligação</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="whatsapp_call">WhatsApp Ligação</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          'h-8 w-full justify-start text-xs font-normal',
                          !returnDate && 'text-muted-foreground',
                        )}
                      >
                        <CalendarIcon className="mr-1 h-3 w-3" />
                        {returnDate ? format(returnDate, 'dd/MM', { locale: ptBR }) : 'Data'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={returnDate}
                        onSelect={setReturnDate}
                        locale={ptBR}
                        disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Horário</Label>
                  <Select value={returnTime} onValueChange={setReturnTime}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 8)
                        .flatMap((h) => [
                          `${h.toString().padStart(2, '0')}:00`,
                          `${h.toString().padStart(2, '0')}:30`,
                        ])
                        .map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                {missingReturnDate ? 'Escolha a data para concluir.' : returnReadyMessage}
              </p>
            </div>
          )}

          {/* Anotações */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
              <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Anotações
              </Label>
            </div>
            <Textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                onNotesChange?.(e.target.value);
              }}
              placeholder="Faça anotações sobre a ligação..."
              className="min-h-[80px] resize-y"
            />
          </div>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Esquerda: ações discretas — não competem com a primária.
              A saída sem concluir fica no "×" do cabeçalho (onOpenChange →
              onClose); não repetimos como botão pra não competir com "Perdido"
              nem poluir o rodapé. */}
          <div className="flex flex-wrap gap-1">
            {onMarkNoShow && (
              <Button variant="ghost" size="sm" onClick={onMarkNoShow} disabled={isSending}>
                <CalendarX className="mr-1.5 h-3.5 w-3.5" />
                No-show
              </Button>
            )}
            {onLeadLost && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onLeadLost}
                disabled={isSending}
                className="text-[var(--destructive)] hover:text-[var(--destructive)]"
              >
                <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />
                Perdido
              </Button>
            )}
          </div>
          {/* Direita: "Ligar de novo" (primário quando não houve contato —
              não atendida ou caixa postal) + Concluir */}
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {onRetry && (
              <Button
                variant={retryPrimary ? 'default' : 'ghost'}
                onClick={() => onRetry(notes)}
                disabled={isSending}
              >
                <PhoneCall className="mr-2 h-4 w-4" />
                Ligar de novo
              </Button>
            )}
            <Button
              variant={retryPrimary ? 'outline' : 'default'}
              onClick={handleConclude}
              disabled={isSending || missingReturnDate || missingOutcome}
            >
              {isSending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              {suggestion?.alreadyFilled &&
              !outcomeTouched &&
              outcome === suggestion.alreadyFilledDisposition
                ? 'Continuar'
                : keepsTaskOpen
                  ? 'Registrar e voltar à fila'
                  : 'Concluir atividade'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function suggestionBanner(suggestion: PostCallSuggestion | null | undefined) {
  if (!suggestion?.source) return null;
  if (suggestion.alreadyFilled && suggestion.alreadyFilledDisposition) {
    const label = DISPOSITION_REPORT_LABELS[suggestion.alreadyFilledDisposition];
    return (
      <p
        className="rounded-md bg-[var(--muted)] px-3 py-2 text-xs"
        role="status"
        data-testid="auto-filled-banner"
      >
        O sistema já registrou: {label}. Você pode alterar ou só continuar.
      </p>
    );
  }
  const outcomeLabel = suggestion.outcome ? DISPOSITION_REPORT_LABELS[suggestion.outcome] : null;
  const nextLabel = suggestion.nextActivity ? nextActivityLabel(suggestion.nextActivity) : null;
  if (!outcomeLabel && !nextLabel) return null;
  return (
    <p
      className="rounded-md bg-[var(--muted)] px-3 py-2 text-xs"
      role="status"
      data-testid="suggestion-banner"
    >
      {outcomeLabel ? `Sugestão: ${outcomeLabel}.` : null}
      {nextLabel ? ` Próxima atividade: ${nextLabel}.` : null}
      {suggestion.reason ? ` ${suggestion.reason}` : null} Você pode alterar antes de confirmar.
    </p>
  );
}
