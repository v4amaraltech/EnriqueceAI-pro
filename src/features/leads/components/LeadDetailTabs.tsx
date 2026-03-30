'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Calendar,
  Clock,
  ExternalLink,
  Linkedin,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Search,
  Trash2,
  Video,
} from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

import type { TimelineEntry } from '@/features/cadences/cadences.contract';
import { LeadTimeline } from '@/features/cadences/components/LeadTimeline';
import { deleteMeeting } from '@/features/integrations/actions/schedule-meeting';
import { ScheduleMeetingModal } from '@/features/integrations/components/ScheduleMeetingModal';

import { ScheduleActivityForm } from '@/features/activities/components/ScheduleActivityForm';

import type { LeadRow } from '../types';
import { LeadNotes } from './LeadNotes';

interface LeadDetailTabsProps {
  lead: LeadRow;
  timeline: TimelineEntry[];
  showMeeting: boolean;
  onShowMeetingChange: (open: boolean) => void;
}

type ChannelFilter = 'all' | 'research' | 'whatsapp' | 'email' | 'phone' | 'linkedin';

const channelFilters: { value: ChannelFilter; label: string; icon: typeof Mail }[] = [
  { value: 'all', label: 'Tudo', icon: Clock },
  { value: 'research', label: 'Pesquisa', icon: Search },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'phone', label: 'Ligação', icon: Phone },
  { value: 'linkedin', label: 'LinkedIn', icon: Linkedin },
];

export function LeadDetailTabs({ lead, timeline, showMeeting, onShowMeetingChange }: LeadDetailTabsProps) {
  const router = useRouter();
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [editingMeeting, setEditingMeeting] = useState<TimelineEntry | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleDeleteMeeting(interactionId: string) {
    setDeleteConfirmId(interactionId);
  }

  function confirmDeleteMeeting() {
    if (!deleteConfirmId) return;
    const interactionId = deleteConfirmId;
    setDeleteConfirmId(null);
    setDeletingId(interactionId);
    startDeleteTransition(async () => {
      const result = await deleteMeeting(interactionId);
      if (result.success) {
        toast.success('Reunião excluída');
        router.refresh();
      } else {
        toast.error(result.error);
      }
      setDeletingId(null);
    });
  }

  function handleEditMeeting(meeting: TimelineEntry) {
    setEditingMeeting(meeting);
    onShowMeetingChange(true);
  }

  // Inject synthetic "Lead criado" entry at the end (oldest)
  const timelineWithCreation = useMemo(() => {
    const leadName = lead.nome_fantasia ?? lead.razao_social ?? lead.cnpj ?? 'Lead';
    const creationEntry: TimelineEntry = {
      id: `lead-created-${lead.id}`,
      type: 'sent',
      channel: 'system',
      message_content: `Lead criado com sucesso - ${leadName}`,
      subject: 'Lead criado',
      html_body: null,
      ai_generated: false,
      is_note: false,
      created_at: lead.created_at,
    };
    return [...timeline, creationEntry];
  }, [timeline, lead]);

  const filteredTimeline = useMemo(() => {
    if (channelFilter === 'all') return timelineWithCreation;
    return timelineWithCreation.filter((e) => e.channel === channelFilter || e.channel === 'system');
  }, [timelineWithCreation, channelFilter]);

  const meetings = useMemo(
    () => timeline.filter((e) => e.type === 'meeting_scheduled'),
    [timeline],
  );

  return (
    <>
      <Tabs defaultValue="historico" className="flex-1">
        <TabsList variant="line">
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          <TabsTrigger value="atividade">Agendar atividade</TabsTrigger>
          <TabsTrigger value="anotacoes">Anotações</TabsTrigger>
          <TabsTrigger value="reuniao">Agendar reunião</TabsTrigger>
        </TabsList>

        {/* Histórico Tab */}
        <TabsContent value="historico" className="space-y-4 pt-4">
          {/* Channel filters */}
          <div className="flex flex-wrap gap-1.5">
            {channelFilters.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                variant={channelFilter === value ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setChannelFilter(value)}
              >
                <Icon className="mr-1 h-3 w-3" />
                {label}
              </Button>
            ))}
          </div>

          {/* Timeline */}
          <LeadTimeline entries={filteredTimeline} />
        </TabsContent>

        {/* Agendar atividade Tab */}
        <TabsContent value="atividade" className="pt-4">
          <ScheduleActivityForm leadId={lead.id} />
        </TabsContent>

        {/* Anotações Tab */}
        <TabsContent value="anotacoes" className="pt-4">
          <LeadNotes leadId={lead.id} notes={null} />
        </TabsContent>

        {/* Agendar reunião Tab */}
        <TabsContent value="reuniao" className="pt-4">
          <div className="space-y-4">
            <ScheduleMeetingModal
              open={true}
              onOpenChange={() => {}}
              leadId={lead.id}
              leadEmail={lead.email}
              leadName={lead.nome_fantasia ?? lead.razao_social}
              inline
            />

            {/* Reuniões agendadas */}
            {meetings.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Reuniões agendadas ({meetings.length})
                </h4>
                {meetings.map((m) => {
                  const meta = m.metadata as Record<string, unknown> | undefined;
                  const meetLink = meta?.meet_link as string | undefined;
                  const calendarLink = meta?.calendar_link as string | undefined;
                  return (
                    <div
                      key={m.id}
                      className="rounded-lg border border-[var(--border)] p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          {(meta?.subject as string) ?? m.subject ?? 'Reunião'}
                        </p>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="text-xs text-[var(--muted-foreground)]">
                            {new Date(m.created_at).toLocaleDateString('pt-BR')}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => handleEditMeeting(m)}
                            title="Editar reunião"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteMeeting(m.id)}
                            disabled={isDeleting && deletingId === m.id}
                            title="Excluir reunião"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      {m.message_content && (
                        <p className="text-xs text-[var(--muted-foreground)] whitespace-pre-line">
                          {m.message_content}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {meetLink && (
                          <a
                            href={meetLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
                          >
                            <Video className="h-3 w-3" />
                            Google Meet
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                        {calendarLink && (
                          <a
                            href={calendarLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
                          >
                            <Calendar className="h-3 w-3" />
                            Ver no Calendar
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <ScheduleMeetingModal
        open={showMeeting || !!editingMeeting}
        onOpenChange={(open) => {
          if (!open) setEditingMeeting(null);
          onShowMeetingChange(open);
        }}
        leadId={lead.id}
        leadEmail={lead.email}
        leadName={lead.nome_fantasia ?? lead.razao_social}
        editData={editingMeeting ? (() => {
          const meta = editingMeeting.metadata as Record<string, unknown> | undefined;
          // Parse start/end time from message_content (format: "Horário: DD/MM/YYYY HH:mm:ss - DD/MM/YYYY HH:mm:ss")
          const content = editingMeeting.message_content ?? '';
          const horarioMatch = content.match(/Horário: (.+?) - (.+)$/m);
          let dateStr = '';
          let timeStr = '09:00';
          let durationStr = '30';
          if (horarioMatch?.[1] && horarioMatch?.[2]) {
            // Parse pt-BR date format
            const startParts = horarioMatch[1].trim().split(/[/\s:]/);
            if (startParts.length >= 5) {
              const day = startParts[0];
              const month = startParts[1];
              const year = startParts[2];
              dateStr = `${year}-${month}-${day}`;
              timeStr = `${startParts[3]}:${startParts[4]}`;
            }
            const endParts = horarioMatch[2].trim().split(/[/\s:]/);
            if (startParts.length >= 5 && endParts.length >= 5) {
              const startMin = parseInt(startParts[3] ?? '0') * 60 + parseInt(startParts[4] ?? '0');
              const endMin = parseInt(endParts[3] ?? '0') * 60 + parseInt(endParts[4] ?? '0');
              durationStr = String(endMin - startMin > 0 ? endMin - startMin : 30);
            }
          }
          return {
            interactionId: editingMeeting.id,
            title: (meta?.subject as string) ?? editingMeeting.subject ?? '',
            description: undefined,
            date: dateStr,
            startTime: timeStr,
            duration: durationStr,
            attendeeEmails: ((meta?.attendees as string[]) ?? []).join(', '),
            closerId: (meta?.closer_id as string) ?? undefined,
            generateMeetLink: !!meta?.meet_link,
          };
        })() : null}
      />

      {/* Delete meeting confirmation */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir reunião</DialogTitle>
            <DialogDescription>
              Tem certeza? A reunião também será removida do Google Calendar. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmDeleteMeeting}>Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
