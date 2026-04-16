'use client';

import { useState } from 'react';

import { sanitizeHtml } from '@/lib/security/sanitize-html';
import {
  CalendarCheck,
  ChevronDown,
  ChevronUp,
  Clock,
  Mail,
  MessageSquare,
  Phone,
  Search,
  StickyNote,
  UserPlus,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';

import type { TimelineEntry } from '../cadences.contract';

interface LeadTimelineProps {
  entries: TimelineEntry[];
}

const channelConfig: Record<string, { label: string; icon: typeof Mail; bg: string; text: string }> = {
  email: { label: 'E-mail', icon: Mail, bg: 'bg-blue-100 dark:bg-blue-950', text: 'text-blue-600 dark:text-blue-400' },
  whatsapp: { label: 'WhatsApp', icon: MessageSquare, bg: 'bg-green-100 dark:bg-green-950', text: 'text-green-600 dark:text-green-400' },
  phone: { label: 'Ligação', icon: Phone, bg: 'bg-orange-100 dark:bg-orange-950', text: 'text-orange-600 dark:text-orange-400' },
  linkedin: { label: 'LinkedIn', icon: MessageSquare, bg: 'bg-purple-100 dark:bg-purple-950', text: 'text-purple-600 dark:text-purple-400' },
  research: { label: 'Pesquisa', icon: Search, bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-300' },
  calendar: { label: 'Reunião agendada', icon: CalendarCheck, bg: 'bg-emerald-100 dark:bg-emerald-950', text: 'text-emerald-600 dark:text-emerald-400' },
  system: { label: 'Sistema', icon: UserPlus, bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400' },
};

const noteConfig = { label: 'Anotação', icon: StickyNote, bg: 'bg-yellow-100 dark:bg-yellow-950', text: 'text-yellow-600 dark:text-yellow-400' };
const defaultChannel = { label: 'Atividade', icon: Mail, bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-300' };

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  if (diffMin < 5) return `AGORA, ${time}`;
  if (diffMin < 60) return `${diffMin}min, ${time}`;
  if (diffHours < 24) {
    if (date.toDateString() === now.toDateString()) return `HOJE, ${time}`;
    return `ONTEM, ${time}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `ONTEM, ${time}`;

  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + `, ${time}`;
}

function formatFullDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const HTML_TAG_RE = /<\/?[a-z][\s\S]*?>/i;

function TimelineMessageContent({ entry, isShortForm }: { entry: TimelineEntry; isShortForm: boolean }) {
  const [expanded, setExpanded] = useState(false);
  // Use html_body if available; fallback to message_content when it contains HTML tags
  const htmlContent = entry.html_body ?? (entry.message_content && HTML_TAG_RE.test(entry.message_content) ? entry.message_content : null);
  const hasHtml = !!htmlContent;
  const hasContent = hasHtml || !!entry.message_content;

  if (!hasContent) {
    if (entry.step_instructions) {
      return (
        <p className="mt-2 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)] italic">
          {entry.step_instructions}
        </p>
      );
    }
    return (
      <p className="mt-2 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)] italic">
        Nenhuma anotação
      </p>
    );
  }

  // Research, notes, phone — show full content without truncation
  if (isShortForm) {
    return (
      <div className="mt-2">
        {entry.subject && (
          <p className="text-sm font-semibold text-[var(--foreground)]">
            {entry.subject}
          </p>
        )}
        {hasHtml ? (
          <div
            className="prose prose-sm max-w-none whitespace-pre-line mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)] [&_p]:my-3 [&_br]:block"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(htmlContent!) }}
          />
        ) : (
          <p className="mt-1 whitespace-pre-line text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            {entry.message_content}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2">
      {entry.subject && (
        <p className="text-sm font-semibold text-[var(--foreground)]">
          {entry.subject}
        </p>
      )}
      {hasHtml ? (
        <>
          <div
            className={`mt-1 overflow-hidden text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)] transition-all ${
              expanded ? 'max-h-[800px]' : 'max-h-28'
            }`}
          >
            <div
              className="prose prose-sm max-w-none whitespace-pre-line text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)] [&_p]:my-3 [&_br]:block"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(htmlContent!) }}
            />
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1.5 flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" />
                Recolher
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                Ver mensagem completa
              </>
            )}
          </button>
        </>
      ) : (
        <p className="mt-1 whitespace-pre-line text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          {entry.message_content}
        </p>
      )}
    </div>
  );
}

export function LeadTimeline({ entries }: LeadTimelineProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" />
          Timeline de Atividades
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Nenhuma interação registrada ainda.
          </p>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[18px] top-0 bottom-0 w-px bg-[var(--border)]" />

            <div className="space-y-6">
              {entries.map((entry) => {
                const isNote = entry.is_note;
                const isSystem = entry.channel === 'system';
                const channel = isNote ? noteConfig : (channelConfig[entry.channel] ?? defaultChannel);
                const ChannelIcon = channel.icon;
                const stepLabel = !isNote && !isSystem && entry.step_order != null ? ` ${entry.step_order}` : '';
                const systemEvent = (entry.metadata as Record<string, unknown> | null)?.system_event as string | undefined;
                const systemTitles: Record<string, string> = {
                  lead_created: 'Lead criado',
                  lead_won: 'Lead ganho',
                  lead_lost: 'Lead perdido',
                  activity_scheduled: 'Atividade agendada',
                  fields_updated: 'Campos atualizados',
                  enrollment_added: 'Inscrito em cadência',
                  enrollment_status_changed: 'Cadência atualizada',
                  enrollment_removed: 'Removido da cadência',
                  status_changed: 'Status alterado',
                  lead_assigned: 'Lead atribuído',
                  lead_archived: 'Lead arquivado',
                  meeting_invite_sent: 'Convite de reunião enviado',
                };
                const title = isSystem
                  ? (entry.performed_by_name
                    ? `${entry.performed_by_name}`
                    : systemTitles[systemEvent ?? ''] ?? 'Atividade do sistema')
                  : entry.step_activity_name || `${channel.label}${stepLabel}`;

                return (
                  <div key={entry.id} className="relative flex gap-4">
                    {/* Channel icon circle */}
                    <div
                      className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${channel.bg} ${channel.text}`}
                    >
                      <ChannelIcon className="h-4 w-4" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pb-1">
                      {/* Header: title + date */}
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-[var(--foreground)]">
                          {title}
                        </span>
                        <span
                          className="shrink-0 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]"
                          title={formatFullDate(entry.created_at)}
                        >
                          {formatRelativeDate(entry.created_at)}
                        </span>
                      </div>

                      {/* Message content */}
                      {isSystem ? (
                        <div className="mt-2 rounded-lg border border-[var(--border)] p-3">
                          <p className="text-sm font-semibold text-[var(--foreground)]">{entry.subject}</p>
                          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{entry.message_content}</p>
                        </div>
                      ) : (
                        <TimelineMessageContent entry={entry} isShortForm={isNote || entry.channel === 'research' || entry.channel === 'phone'} />
                      )}

                      {/* Call recording + transcription */}
                      {entry.channel === 'phone' && entry.recording_url && (
                        <div className="mt-2 space-y-2">
                          <div className="flex items-center gap-2">
                            <audio controls preload="none" className="h-8 max-w-[300px]">
                              <source src={entry.recording_url} type="audio/mpeg" />
                            </audio>
                            {entry.call_duration && (
                              <span className="text-[10px] text-[var(--muted-foreground)]">
                                {Math.floor(entry.call_duration / 60)}:{String(entry.call_duration % 60).padStart(2, '0')}
                              </span>
                            )}
                          </div>
                          {entry.transcription && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-[var(--primary)] hover:underline">
                                Ver transcrição
                              </summary>
                              <p className="mt-1 whitespace-pre-line text-[var(--muted-foreground)] bg-[var(--muted)]/30 rounded p-2">
                                {entry.transcription}
                              </p>
                            </details>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
