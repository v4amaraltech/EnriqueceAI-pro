import type { ChatChannel } from './model';

export interface ChatPeer {
  name: string;
  address: string | null;
  chips: string[];
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Novo',
  contacted: 'Contactado',
  qualified: 'Qualificado',
  won: 'Ganho',
  unqualified: 'Não qualificado',
  archived: 'Arquivado',
};

export function chatInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`;
  return (letters || '?').toLocaleUpperCase('pt-BR');
}

export function formatChatPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11) return `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `+55 (${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return raw;
}

export function chatPeerFromLead(lead: {
  nome_fantasia?: string | null;
  razao_social?: string | null;
  first_name?: string | null;
  telefone?: string | null;
  phones?: Array<{ numero?: string | null }> | null;
  email?: string | null;
  emails?: Array<{ email?: string | null }> | null;
  status?: string | null;
  whatsapp_invalid_at?: string | null;
  email_bounced_at?: string | null;
}, channel: ChatChannel): ChatPeer {
  const name = lead.nome_fantasia?.trim()
    || lead.razao_social?.trim()
    || lead.first_name?.trim()
    || 'Lead';
  const phone = lead.telefone?.trim() || lead.phones?.find((item) => item.numero?.trim())?.numero?.trim() || null;
  const email = lead.email?.trim() || lead.emails?.find((item) => item.email?.trim())?.email?.trim() || null;
  const chips: string[] = [];
  const status = lead.status ? STATUS_LABEL[lead.status] : null;
  if (status) chips.push(status);
  if (channel === 'whatsapp' && lead.whatsapp_invalid_at) chips.push('WhatsApp inválido');
  if (channel === 'email' && lead.email_bounced_at) chips.push('E-mail devolvido');
  return {
    name,
    address: channel === 'whatsapp' ? phone : email,
    chips,
  };
}
