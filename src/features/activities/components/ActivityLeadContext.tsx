'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { from } from '@/lib/supabase/from';

import type { TimelineEntry } from '@/features/cadences/cadences.contract';
import { LeadInfoPanel } from '@/features/leads/components/LeadInfoPanel';
import { activityLeadToInfoPanelData } from '@/features/leads/components/lead-info-panel.utils';

import type { ActivityLead } from '../types';

interface ActivityLeadContextProps {
  lead: ActivityLead;
  cadenceName: string;
  stepOrder: number;
  totalSteps: number;
}

export function ActivityLeadContext({ lead, cadenceName, stepOrder, totalSteps }: ActivityLeadContextProps) {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);

  useEffect(() => {
    const supabase = createClient();

    (async () => {
      const { data } = (await from(supabase, 'interactions')
        .select('id, type, channel, message_content, ai_generated, created_at')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(20)) as { data: TimelineEntry[] | null };

      setTimeline(data ?? []);
    })();
  }, [lead.id]);

  return (
    <LeadInfoPanel
      data={activityLeadToInfoPanelData(lead)}
      timeline={timeline}
      showLeadHeader
      cadenceConfig={{ cadenceName, stepOrder, totalSteps }}
    />
  );
}
