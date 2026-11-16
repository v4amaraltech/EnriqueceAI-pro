import type { ReactNode } from 'react';

import { useLeadHistory } from './use-lead-history';

const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function CallHistoryList({ timeline }: { timeline: ReturnType<typeof useLeadHistory> }): ReactNode {
  return (
    <>
      {timeline.status === 'loading' && <p className="text-muted-foreground mt-1 text-xs">Carregando histórico...</p>}
      {timeline.status === 'error' && <p className="mt-1 text-xs text-amber-700">Não foi possível carregar o histórico.</p>}
      {timeline.status === 'ready' && timeline.entries.length === 0 && (
        <p className="text-muted-foreground mt-1 text-xs">Nenhum contato registrado ainda.</p>
      )}
      {timeline.status === 'ready' && timeline.entries.length > 0 && (
        <ol className="mt-2 space-y-2">
          {timeline.entries.map((entry) => (
            <li key={entry.id} className="border-l-2 border-primary/40 pl-2">
              <p className="text-[11px] font-medium">{entry.title}</p>
              <p className="text-muted-foreground text-[10px]">{timeFmt.format(new Date(entry.at))}</p>
              {entry.detail && <p className="text-xs">{entry.detail}</p>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
