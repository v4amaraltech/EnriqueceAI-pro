'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { from } from '@/lib/supabase/from';
import { isUuid } from '@/lib/utils/uuid';

import { toCallHistory, type CallHistoryEntry, type CallHistorySource } from '../utils/call-history';

/**
 * Histórico append-only já gravado em `interactions`. Somente leitura.
 * `provided` (fixture ou teste) não consulta o banco.
 */
export function useLeadHistory(leadId: string, provided?: CallHistoryEntry[]): {
  entries: CallHistoryEntry[];
  status: 'loading' | 'ready' | 'error';
} {
  const [entries, setEntries] = useState<CallHistoryEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (provided || !isUuid(leadId)) return;
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      const { data, error } = (await from(supabase, 'interactions')
        .select('id, type, channel, message_content, created_at')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: true })
        .limit(50)) as { data: CallHistorySource[] | null; error: { message: string } | null };
      if (cancelled) return;
      if (error) {
        setStatus('error');
        return;
      }
      setEntries(toCallHistory(data ?? []));
      setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, provided]);

  if (provided) return { entries: provided, status: 'ready' };
  if (!isUuid(leadId)) return { entries: [], status: 'ready' };
  return { entries, status };
}
