'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { from } from '@/lib/supabase/from';

import type { TimelineEntry } from '@/features/cadences/cadences.contract';
import { LeadInfoPanel } from '@/features/leads/components/LeadInfoPanel';
import { activityLeadToInfoPanelData } from '@/features/leads/components/lead-info-panel.utils';
import type { CustomFieldRow } from '@/features/settings-prospecting/types/custom-field';
import type { StandardFieldSettingRow } from '@/features/settings-prospecting/actions/standard-field-settings';

import type { ActivityLead } from '../types';

interface ActivityLeadContextProps {
  lead: ActivityLead;
  cadenceName: string;
  stepOrder: number;
  totalSteps: number;
  customFieldDefs?: CustomFieldRow[];
}

export function ActivityLeadContext({ lead, cadenceName, stepOrder, totalSteps, customFieldDefs: propDefs }: ActivityLeadContextProps) {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldRow[]>(propDefs ?? []);
  const [standardFieldSettings, setStandardFieldSettings] = useState<StandardFieldSettingRow[]>([]);

  useEffect(() => {
    const supabase = createClient();

    async function fetchTimeline() {
      const { data } = (await from(supabase, 'interactions')
        .select('id, type, channel, message_content, ai_generated, created_at, metadata, performed_by')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(50)) as { data: TimelineEntry[] | null };

      setTimeline(data ?? []);
    }

    fetchTimeline();

    // Subscribe to new interactions for this lead
    const channel = supabase
      .channel(`timeline-${lead.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'interactions', filter: `lead_id=eq.${lead.id}` },
        () => { fetchTimeline(); },
      )
      .subscribe();

    // Fetch visible custom fields if not provided via props
    if (!propDefs) {
      (async () => {
        const { data } = (await from(supabase, 'custom_fields')
          .select('*')
          .eq('is_visible', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })) as { data: CustomFieldRow[] | null };

        setCustomFieldDefs(data ?? []);
      })();
    }

    // Fetch standard field settings for visibility
    (async () => {
      const { data } = (await from(supabase, 'standard_field_settings')
        .select('*')) as { data: StandardFieldSettingRow[] | null };

      setStandardFieldSettings(data ?? []);
    })();

    return () => { supabase.removeChannel(channel); };
  }, [lead.id, propDefs]);

  return (
    <LeadInfoPanel
      data={activityLeadToInfoPanelData(lead)}
      timeline={timeline}
      showLeadHeader
      cadenceConfig={{ cadenceName, stepOrder, totalSteps }}
      customFieldDefs={customFieldDefs}
      standardFieldSettings={standardFieldSettings}
    />
  );
}
