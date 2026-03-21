'use client';

import { useMemo, useState } from 'react';
import {
  Calendar,
  Clock,
  Linkedin,
  Mail,
  MessageSquare,
  Phone,
  Search,
} from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

import type { TimelineEntry } from '@/features/cadences/cadences.contract';
import { LeadTimeline } from '@/features/cadences/components/LeadTimeline';
import { ScheduleMeetingModal } from '@/features/integrations/components/ScheduleMeetingModal';

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
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');

  const filteredTimeline = useMemo(() => {
    if (channelFilter === 'all') return timeline;
    return timeline.filter((e) => e.channel === channelFilter);
  }, [timeline, channelFilter]);

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
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Agendamento de atividades em breve
          </div>
        </TabsContent>

        {/* Anotações Tab */}
        <TabsContent value="anotacoes" className="pt-4">
          <LeadNotes leadId={lead.id} notes={null} />
        </TabsContent>

        {/* Agendar reunião Tab */}
        <TabsContent value="reuniao" className="pt-4">
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Agende uma reunião com este lead via Google Calendar.
            </p>
            <Button onClick={() => onShowMeetingChange(true)}>
              <Calendar className="mr-2 h-4 w-4" />
              Agendar Reunião
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      <ScheduleMeetingModal
        open={showMeeting}
        onOpenChange={onShowMeetingChange}
        leadId={lead.id}
        leadEmail={lead.email}
        leadName={lead.nome_fantasia ?? lead.razao_social}
      />
    </>
  );
}
