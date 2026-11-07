import type { PendingActivity } from '@/features/activities/types';

export const TASK_CHANNEL_TABS = [
  { key: 'all', label: 'Todas' },
  { key: 'phone', label: 'Ligação' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'E-mail' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'research', label: 'Pesquisa' },
] as const;

export type TaskChannelKey = (typeof TASK_CHANNEL_TABS)[number]['key'];

/** Quantas tarefas há em cada aba de canal (a aba "Todas" soma tudo). */
export function countByChannel(activities: PendingActivity[]): Record<TaskChannelKey, number> {
  const counts: Record<TaskChannelKey, number> = { all: 0, phone: 0, whatsapp: 0, email: 0, linkedin: 0, research: 0 };
  for (const a of activities) {
    counts.all += 1;
    if (a.channel in counts) counts[a.channel as TaskChannelKey] += 1;
  }
  return counts;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Busca por tarefa, cadência ou lead (empresa, contato, telefone). */
export function matchesTaskSearch(a: PendingActivity, query: string): boolean {
  const q = normalize(query.trim());
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  const haystack = normalize(
    [
      a.activityName,
      a.cadenceName,
      a.lead.nome_fantasia,
      a.lead.razao_social,
      a.lead.first_name,
      a.lead.last_name,
    ]
      .filter(Boolean)
      .join(' '),
  );
  if (haystack.includes(q)) return true;
  if (digits.length >= 4) {
    const phones = [a.lead.telefone, ...(Array.isArray(a.lead.phones) ? a.lead.phones : []).map((p) => (typeof p === "string" ? p : p?.numero))]
      .filter(Boolean)
      .map((p) => String(p).replace(/\D/g, ''));
    return phones.some((p) => p.includes(digits));
  }
  return false;
}

export function filterTasks(activities: PendingActivity[], channel: TaskChannelKey, query: string): PendingActivity[] {
  return activities.filter((a) => (channel === 'all' || a.channel === channel) && matchesTaskSearch(a, query));
}
