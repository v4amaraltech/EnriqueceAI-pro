'use client';

import {
  Bell,
  ChevronDown,
  ExternalLink,
  Mail,
} from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import type { TimelineEntry } from '@/features/cadences/cadences.contract';
import type { InteractionType } from '@/features/cadences/types';

import { EngagementScoreBadge } from './EngagementScoreBadge';
import { typeConfig, channelIcon, formatTimelineDate } from './LeadTimelineTab';

interface LeadInfoPanelHeaderProps {
  leadId: string;
  avatarInitial: string;
  headerName: string;
  headerCompany: string | null;
  fitScore: number | null;
  engagementScore: number | null;
  timeline: TimelineEntry[] | undefined;
  onNavigateToTimeline: () => void;
}

const notableTypes: InteractionType[] = ['replied', 'meeting_scheduled', 'bounced'];

export function LeadInfoPanelHeader({
  leadId,
  avatarInitial,
  headerName,
  headerCompany,
  fitScore,
  engagementScore,
  timeline,
  onNavigateToTimeline,
}: LeadInfoPanelHeaderProps) {
  const notableEvents = (timeline ?? []).filter((e) => notableTypes.includes(e.type));
  const notableCount = notableEvents.length;

  return (
    <div className="mb-20 flex items-center gap-3">
      <div className="relative">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/10 text-lg font-semibold text-[var(--primary)]">
          {avatarInitial}
        </div>
        {fitScore != null && fitScore > 0 && (
          <span className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
            {fitScore}
          </span>
        )}
        {engagementScore != null && (
          <span className="absolute -top-1 -left-1">
            <EngagementScoreBadge score={engagementScore} size={22} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">{headerName}</p>
        {headerCompany && (
          <p className="truncate text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{headerCompany}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-8 w-8" title="Notificações do lead">
              <Bell className="h-4 w-4" />
              {notableCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white">
                  {notableCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <p className="px-2 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Notificações do Lead
            </p>
            {notableCount === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Nenhuma notificação
              </div>
            ) : (
              notableEvents.slice(0, 8).map((entry) => {
                const config = typeConfig[entry.type];
                const Icon = config.icon;
                const ChannelIcon = channelIcon[entry.channel] ?? Mail;
                return (
                  <DropdownMenuItem key={entry.id} className="flex gap-2 py-2" onSelect={onNavigateToTimeline}>
                    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] ${config.className}`}>
                      <Icon className="h-3 w-3" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-medium">{config.label}</span>
                        <ChannelIcon className="h-3 w-3 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                      </div>
                      {entry.cadence_name && (
                        <p className="truncate text-[10px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                          {entry.cadence_name}
                        </p>
                      )}
                      <p className="text-[10px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                        {formatTimelineDate(entry.created_at)}
                      </p>
                    </div>
                  </DropdownMenuItem>
                );
              })
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => window.open(`/leads/${leadId}`, '_blank')}
            >
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Ver lead completo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
