export interface CallHistorySource {
  id: string;
  type: string;
  channel: string;
  message_content: string | null;
  created_at: string;
}

export interface CallHistoryEntry {
  id: string;
  at: string;
  title: string;
  detail: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  sent: 'Envio',
  delivered: 'Entregue',
  opened: 'Abriu',
  clicked: 'Clicou',
  replied: 'Respondeu',
  bounced: 'Retornou',
  failed: 'Falhou',
  meeting_scheduled: 'Reunião agendada',
  call: 'Ligação',
  note: 'Nota',
  task_completed: 'Tarefa concluída',
};

const CHANNEL_LABEL: Record<string, string> = {
  phone: 'telefone',
  whatsapp: 'WhatsApp',
  email: 'e-mail',
  linkedin: 'LinkedIn',
  calendar: 'agenda',
  research: 'pesquisa',
  system: 'sistema',
};

function excerpt(text: string | null): string | null {
  const clean = text?.replace(/\s+/g, ' ').trim() ?? '';
  if (!clean) return null;
  return clean.length > 180 ? `${clean.slice(0, 177)}...` : clean;
}

/** Histórico cronológico (mais antigo primeiro). Não remove nem reescreve a origem. */
export function toCallHistory(rows: CallHistorySource[]): CallHistoryEntry[] {
  return [...rows]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((row) => {
      const action = TYPE_LABEL[row.type] ?? row.type;
      const channel = CHANNEL_LABEL[row.channel];
      return {
        id: row.id,
        at: row.created_at,
        title: channel ? `${action} · ${channel}` : action,
        detail: excerpt(row.message_content),
      };
    });
}

const PLACEHOLDER_SCRIPT = /em breve[\s\S]{0,40}script de liga/i;

/** Oculta o placeholder de roteiro. Texto real do passo continua visível. */
export function usefulCallScript(script: string | null | undefined): string | null {
  const text = script?.trim() ?? '';
  if (!text || PLACEHOLDER_SCRIPT.test(text)) return null;
  return text;
}
