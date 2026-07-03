'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Clock, DollarSign, FileText, Mic, Phone, Send, User } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Separator } from '@/shared/components/ui/separator';
import { Textarea } from '@/shared/components/ui/textarea';

import { formatDateTime, formatDuration } from '@/lib/utils/format';

import { WhatsAppGlyph } from '@/features/whatsapp-calls/components/WhatsAppGlyph';

import type { CallDetail, CallFeedbackRow, CallStatus } from '../types';
import { callStatusValues } from '../schemas/call.schemas';
import { addCallFeedback } from '../actions/add-call-feedback';
import { fetchCallRecording } from '../actions/fetch-call-recording';
import { updateCallStatus } from '../actions/update-call-status';
import { CallStatusIcon } from './CallStatusIcon';

const statusLabels: Record<string, string> = {
  significant: 'Significativa',
  not_significant: 'Não Significativa',
  no_contact: 'Sem Contato',
  busy: 'Ocupado',
  not_connected: 'Não Conectada',
};

const typeLabels: Record<string, string> = {
  inbound: 'Recebida',
  outbound: 'Realizada',
  manual: 'Manual',
};

interface CallDetailModalProps {
  call: CallDetail | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

export function CallDetailModal({ call, open, onClose, onUpdated }: CallDetailModalProps) {
  const [feedbackContent, setFeedbackContent] = useState('');
  const [feedbackList, setFeedbackList] = useState<CallFeedbackRow[]>([]);
  const [currentStatus, setCurrentStatus] = useState<CallStatus | null>(null);
  const [fetchedRecordingUrl, setFetchedRecordingUrl] = useState<string | null>(null);
  const [isFetchingRecording, setIsFetchingRecording] = useState(false);
  const [isPending, startTransition] = useTransition();

  const autoFetchedRef = useRef<string | null>(null);

  // Sync state when call changes
  const activeCall = call;
  const displayFeedback = feedbackList.length > 0 ? feedbackList : (activeCall?.feedback ?? []);
  const displayStatus = currentStatus ?? activeCall?.status ?? 'not_connected';

  // Auto-fetch recording when modal opens if call has duration but no recording
  useEffect(() => {
    if (!open || !activeCall) return;
    if (activeCall.recording_url || fetchedRecordingUrl) return;
    if (activeCall.duration_seconds <= 0) return;
    if (autoFetchedRef.current === activeCall.id) return;

    autoFetchedRef.current = activeCall.id;
    setIsFetchingRecording(true);
    fetchCallRecording(activeCall.id)
      .then((result) => {
        if (result.success && result.data.recording_url) {
          setFetchedRecordingUrl(result.data.recording_url);
          toast.success('Gravação encontrada!');
          onUpdated?.();
        } else if (!result.success) {
          console.warn('[CallDetailModal] auto-fetch failed:', result.error);
        }
      })
      .catch((err) => console.error('[CallDetailModal] auto-fetch error:', err))
      .finally(() => setIsFetchingRecording(false));
  }, [open, activeCall, fetchedRecordingUrl, onUpdated]);

  const handleStatusChange = useCallback(
    (newStatus: string) => {
      if (!activeCall) return;
      setCurrentStatus(newStatus as CallStatus);
      startTransition(async () => {
        const result = await updateCallStatus({
          id: activeCall.id,
          status: newStatus,
        });
        if (result.success) {
          toast.success('Status atualizado');
          onUpdated?.();
        } else {
          toast.error(result.error);
          setCurrentStatus(null);
        }
      });
    },
    [activeCall, onUpdated],
  );

  const handleAddFeedback = useCallback(() => {
    if (!activeCall || !feedbackContent.trim()) return;
    startTransition(async () => {
      const result = await addCallFeedback({
        call_id: activeCall.id,
        content: feedbackContent.trim(),
      });
      if (result.success) {
        setFeedbackList((prev) => {
          const base = prev.length > 0 ? prev : (activeCall.feedback ?? []);
          return [...base, result.data];
        });
        setFeedbackContent('');
        toast.success('Feedback adicionado');
        onUpdated?.();
      } else {
        toast.error(result.error);
      }
    });
  }, [activeCall, feedbackContent, onUpdated]);

  const handleFetchRecording = useCallback(async () => {
    if (!activeCall) return;
    setIsFetchingRecording(true);
    try {
      const result = await fetchCallRecording(activeCall.id);
      if (result.success && result.data.recording_url) {
        setFetchedRecordingUrl(result.data.recording_url);
        toast.success('Gravação encontrada!');
        onUpdated?.();
      } else if (result.success) {
        toast.info('Gravação ainda não disponível na API4COM');
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsFetchingRecording(false);
    }
  }, [activeCall, onUpdated]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        setFeedbackContent('');
        setFeedbackList([]);
        setCurrentStatus(null);
        setFetchedRecordingUrl(null);
        autoFetchedRef.current = null;
        onClose();
      }
    },
    [onClose],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl w-full max-h-[85vh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="border-b border-[var(--border)] bg-[var(--muted)]/50 px-6 py-4 space-y-0">
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-[var(--primary)]" />
            Detalhes da Ligação
          </DialogTitle>
        </DialogHeader>

        {activeCall && (
          <div className="flex-1 overflow-y-auto">
            {/* Audio Player */}
            <div className="border-b px-6 py-4">
              {(activeCall.recording_url || fetchedRecordingUrl) ? (
                <div className="space-y-2 rounded-lg bg-[var(--muted)] p-4">
                  <div className="flex items-center gap-2">
                    <Mic className="h-4 w-4 text-[var(--primary)]" />
                    <span className="text-xs font-medium">Gravação da ligação</span>
                    <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                      {formatDuration(activeCall.duration_seconds)}
                    </span>
                  </div>
                  <audio
                    controls
                    src={`/api/proxy/recording?callId=${activeCall.id}`}
                    className="w-full h-10"
                    preload="metadata"
                  />
                </div>
              ) : (
                <div className="space-y-3 rounded-lg bg-[var(--muted)] p-4">
                  <div className="flex items-center gap-3">
                    <Mic className="h-5 w-5 text-muted-foreground" />
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-[var(--border)]">
                        {isFetchingRecording && (
                          <div className="h-2 w-1/3 rounded-full bg-[var(--primary)] animate-pulse" />
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {isFetchingRecording ? 'Buscando gravação...' : 'Gravação não disponível'}
                      </p>
                    </div>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {formatDuration(activeCall.duration_seconds)}
                    </span>
                  </div>
                  {activeCall.duration_seconds > 0 && !isFetchingRecording && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={isFetchingRecording}
                      onClick={handleFetchRecording}
                    >
                      <Mic className="mr-2 h-4 w-4" />
                      Tentar novamente
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Transcription */}
            {activeCall.transcription && (
              <div className="border-b px-6 py-4">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4 text-[var(--primary)]" />
                  <span className="text-xs font-medium">Transcrição</span>
                </div>
                <div className="rounded-lg bg-[var(--muted)] p-3 max-h-[200px] overflow-y-auto">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{activeCall.transcription}</p>
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="border-b border-[var(--border)] px-6 py-4 space-y-3">
              {/* Status dropdown */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Status</span>
                <Select value={displayStatus} onValueChange={handleStatusChange}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {callStatusValues.map((s) => (
                      <SelectItem key={s} value={s}>
                        <span className="flex items-center gap-2">
                          <CallStatusIcon status={s} />
                          {statusLabels[s]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--muted)]/40 p-3">
                <div>
                  <p className="text-xs text-[var(--muted-foreground)]">Origem</p>
                  {activeCall.origin === 'whatsapp' || activeCall.metadata?.provider === 'whatsapp' ? (
                    <Badge className="mt-0.5 gap-1 border-transparent bg-[#25D366] text-white hover:bg-[#25D366]">
                      <WhatsAppGlyph className="size-3" />
                      WhatsApp
                    </Badge>
                  ) : (
                    <p className="text-sm font-semibold">{activeCall.origin}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-[var(--muted-foreground)]">Destino</p>
                  <p className="text-sm font-semibold">{activeCall.destination}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted-foreground)]">Data</p>
                  <p className="text-sm font-medium">{formatDateTime(activeCall.started_at)}</p>
                </div>
                <div className="flex items-start gap-1.5">
                  <Clock className="mt-0.5 h-3.5 w-3.5 text-blue-400" />
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Duração</p>
                    <p className="text-sm font-medium tabular-nums">{formatDuration(activeCall.duration_seconds)}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted-foreground)]">Tipo</p>
                  <Badge variant="outline" className="mt-0.5">{typeLabels[activeCall.type] ?? activeCall.type}</Badge>
                </div>
                {activeCall.cost != null && (
                  <div className="flex items-start gap-1.5">
                    <DollarSign className="mt-0.5 h-3.5 w-3.5 text-green-400" />
                    <div>
                      <p className="text-xs text-[var(--muted-foreground)]">Custo</p>
                      <p className="text-sm font-medium">R$ {activeCall.cost.toFixed(2)}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Notes */}
              {activeCall.notes && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Anotações</p>
                    <p className="text-sm whitespace-pre-wrap">{activeCall.notes}</p>
                  </div>
                </>
              )}
            </div>

            {/* Feedback section */}
            <div className="bg-[var(--muted)]/30 px-6 py-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Send className="h-3.5 w-3.5 text-[var(--primary)]" />
                Feedback
              </h3>

              {/* Existing feedback */}
              {displayFeedback.length > 0 ? (
                <div className="space-y-3">
                  {displayFeedback.map((fb) => (
                    <div
                      key={fb.id}
                      className="flex gap-3 rounded-lg border border-[var(--border)] p-3"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--muted)]">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(fb.created_at)}
                        </p>
                        <p className="mt-1 text-sm whitespace-pre-wrap">{fb.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum feedback adicionado.
                </p>
              )}

              {/* Add feedback */}
              <div className="flex gap-2">
                <Textarea
                  placeholder="Adicionar feedback..."
                  value={feedbackContent}
                  onChange={(e) => setFeedbackContent(e.target.value)}
                  className="min-h-[60px]"
                />
                <Button
                  size="sm"
                  onClick={handleAddFeedback}
                  disabled={isPending || !feedbackContent.trim()}
                  className="shrink-0 self-end"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
