/**
 * Monta o painel do Cockpit (story whatsapp-evolution-paced-sending, critérios
 * 12–14) a partir das linhas do banco. Pura: o filtro de quem vê o quê é feito
 * aqui, além do RLS, para o SDR nunca receber o número de outro SDR.
 */
import { brtDayStartIso } from './pacing';

export interface CockpitInstanceRow {
  id: string;
  user_id: string | null;
  phone: string | null;
  status: string;
  auto_send_daily_limit: number;
  auto_send_next_at: string | null;
  auto_send_paused_at: string | null;
  auto_send_pause_reason: string | null;
}

export interface CockpitQueueItemRow {
  id: string;
  sender_user_id: string;
  lead_id: string;
  status: string;
  reason: string | null;
  counts_toward_limit: boolean;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  lead: { nome_fantasia: string | null; razao_social: string | null } | null;
  cadence: { name: string | null } | null;
}

export interface CockpitNumber {
  instanceId: string;
  userId: string;
  userName: string;
  phone: string | null;
  connected: boolean;
  dailyLimit: number;
  /** Contatos novos enviados hoje (contam no limite). */
  sentTodayCounted: number;
  /** Todos os envios de hoje, inclusive para quem já respondeu. */
  sentTodayTotal: number;
  pending: number;
  failedToday: number;
  pausedAt: string | null;
  pauseReason: string | null;
  /** Próximo envio permitido, só quando ainda está no futuro. */
  nextAt: string | null;
}

export interface CockpitQueueRow {
  id: string;
  userId: string;
  userName: string;
  leadId: string;
  leadName: string;
  cadenceName: string;
  status: string;
  reason: string | null;
  /** Quando saiu (enviado) ou quando entrou na fila. */
  at: string;
}

export interface CockpitData {
  isManager: boolean;
  /** O usuário logado tem número próprio conectado ao app? */
  ownHasNumber: boolean;
  numbers: CockpitNumber[];
  queue: CockpitQueueRow[];
}

export function buildCockpit(params: {
  now: Date;
  viewerId: string;
  isManager: boolean;
  instances: CockpitInstanceRow[];
  items: CockpitQueueItemRow[];
  names: ReadonlyMap<string, string>;
}): CockpitData {
  const { now, viewerId, isManager, names } = params;
  const dayStart = brtDayStartIso(now);
  const nameOf = (id: string) => names.get(id) ?? id.slice(0, 8);

  // Só números de SDR (user_id preenchido). SDR vê apenas o próprio (critério 14).
  const instances = params.instances.filter(
    (i): i is CockpitInstanceRow & { user_id: string } => !!i.user_id && (isManager || i.user_id === viewerId),
  );
  const visibleUsers = new Set(instances.map((i) => i.user_id));
  const items = params.items.filter((it) => (isManager ? true : it.sender_user_id === viewerId));

  const numbers: CockpitNumber[] = instances
    .map((i) => {
      const mine = items.filter((it) => it.sender_user_id === i.user_id);
      const sentToday = mine.filter((it) => it.status === 'sent' && !!it.sent_at && it.sent_at >= dayStart);
      return {
        instanceId: i.id,
        userId: i.user_id,
        userName: nameOf(i.user_id),
        phone: i.phone,
        connected: i.status === 'connected',
        dailyLimit: i.auto_send_daily_limit,
        sentTodayCounted: sentToday.filter((it) => it.counts_toward_limit).length,
        sentTodayTotal: sentToday.length,
        pending: mine.filter((it) => it.status === 'pending' || it.status === 'sending').length,
        failedToday: mine.filter((it) => it.status === 'failed' && it.updated_at >= dayStart).length,
        pausedAt: i.auto_send_paused_at,
        pauseReason: i.auto_send_pause_reason,
        nextAt: i.auto_send_next_at && new Date(i.auto_send_next_at).getTime() > now.getTime() ? i.auto_send_next_at : null,
      };
    })
    .sort((a, b) => a.userName.localeCompare(b.userName, 'pt-BR'));

  const queue: CockpitQueueRow[] = items
    .filter((it) => isManager || visibleUsers.has(it.sender_user_id))
    .map((it) => ({
      id: it.id,
      userId: it.sender_user_id,
      userName: nameOf(it.sender_user_id),
      leadId: it.lead_id,
      leadName: it.lead?.nome_fantasia || it.lead?.razao_social || 'Lead sem nome',
      cadenceName: it.cadence?.name ?? '—',
      status: it.status,
      reason: it.reason,
      at: it.status === 'sent' && it.sent_at ? it.sent_at : it.created_at,
    }))
    // Pendentes primeiro (na ordem em que vão sair), depois o que já aconteceu hoje (mais recente primeiro).
    .sort((a, b) => {
      const pa = a.status === 'pending' || a.status === 'sending';
      const pb = b.status === 'pending' || b.status === 'sending';
      if (pa !== pb) return pa ? -1 : 1;
      return pa ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at);
    });

  return {
    isManager,
    ownHasNumber: params.instances.some((i) => i.user_id === viewerId),
    numbers,
    queue,
  };
}

/** Texto curto do motivo de um item da fila, para a tela. */
export function queueReasonLabel(status: string, reason: string | null): string | null {
  if (!reason) return null;
  if (reason.startsWith('send_error')) return 'Erro no envio — voltou para a fila manual';
  if (reason.startsWith('retry')) return 'Falhou, vai tentar de novo';
  const labels: Record<string, string> = {
    stale: 'A cadência andou antes do envio',
    replied: 'O lead respondeu',
    whatsapp_invalid: 'Lead marcado como "Não é WhatsApp"',
    invalid_number: 'Número sem WhatsApp',
    max_unanswered: '3 mensagens sem resposta — passo pulado',
    no_phone: 'Lead sem telefone — voltou para a fila manual',
    empty_message: 'Template vazio — voltou para a fila manual',
    no_instance: 'Sem WhatsApp próprio — voltou para a fila manual',
    uncertain_send: 'Envio interrompido — confira no WhatsApp',
    owner_changed: 'Veio de outro SDR',
    owner_removed: 'Lead ficou sem responsável',
  };
  return labels[reason] ?? (status === 'failed' ? 'Falhou' : null);
}
