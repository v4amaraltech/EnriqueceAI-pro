'use client';

import { useEffect, useState, useTransition } from 'react';
import { History, Loader2 } from 'lucide-react';

import type { AuditLogEntry } from '../actions/fetch-lead-audit';

const FIELD_LABELS: Record<string, string> = {
  first_name: 'Nome',
  last_name: 'Sobrenome',
  email: 'Email',
  telefone: 'Telefone',
  nome_fantasia: 'Nome Fantasia',
  razao_social: 'Razão Social',
  cnpj: 'CNPJ',
  status: 'Status',
  lead_source: 'Origem',
  canal: 'Sub-origem',
  job_title: 'Cargo',
  linkedin: 'LinkedIn',
  website: 'Website',
  instagram: 'Instagram',
  notes: 'Anotações',
  assigned_to: 'Responsável',
  closer_id: 'Closer',
  is_inbound: 'Inbound',
  porte: 'Porte',
  faturamento_estimado: 'Faturamento Estimado',
  custom_field_values: 'Campos Personalizados',
  phones: 'Telefones',
  socios: 'Sócios',
  email_bounced_at: 'Email Bounce',
};

const STATUS_LABELS: Record<string, string> = {
  new: 'Novo',
  contacted: 'Contatado',
  qualified: 'Qualificado',
  unqualified: 'Não Qualificado',
  archived: 'Arquivado',
};

const ACTION_LABELS: Record<string, string> = {
  'lead.fields_updated': 'Campos atualizados',
  'lead.marked_won': 'Lead marcado como ganho',
  'lead.marked_lost': 'Lead marcado como perdido',
  'lead.created': 'Lead criado',
};

function formatValue(key: string, value: unknown, closerNames?: Record<string, string>): string {
  if (value === null || value === undefined || value === '') return '(vazio)';
  if (key === 'status' && typeof value === 'string') return STATUS_LABELS[value] ?? value;
  if (key === 'closer_id' && typeof value === 'string' && closerNames?.[value]) return closerNames[value];
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d atrás`;
  return new Date(dateStr).toLocaleDateString('pt-BR');
}

interface LeadAuditTabProps {
  leadId: string;
}

export function LeadAuditTab({ leadId }: LeadAuditTabProps) {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const { fetchLeadAudit } = await import('../actions/fetch-lead-audit');
      const result = await fetchLeadAudit(leadId);
      if (result.success) {
        setEntries(result.data);
      }
    });
  }, [leadId]);

  if (isPending || entries === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
        <span className="ml-2 text-sm text-[var(--muted-foreground)]">Carregando histórico...</span>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <History className="h-10 w-10 text-[var(--muted-foreground)] opacity-40" />
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">Nenhuma alteração registrada</p>
        <p className="text-xs text-[var(--muted-foreground)] opacity-70">As alterações nos campos do lead aparecerão aqui</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {entries.map((entry) => (
        <div key={entry.id} className="rounded-lg border border-[var(--border)] p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[var(--muted-foreground)]" />
              <span className="text-sm font-medium">
                {ACTION_LABELS[entry.action] ?? entry.action}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              {entry.user_name && <span>{entry.user_name}</span>}
              <span title={new Date(entry.created_at).toLocaleString('pt-BR')}>
                {formatRelativeTime(entry.created_at)}
              </span>
            </div>
          </div>

          {entry.action === 'lead.fields_updated' && entry.metadata.changes != null && (
            <div className="space-y-1.5 mt-2">
              {Object.entries(entry.metadata.changes as Record<string, { from: unknown; to: unknown }>).map(([field, change]: [string, { from: unknown; to: unknown }]) => (
                <div key={field} className="flex flex-wrap items-baseline gap-1 text-sm">
                  <span className="font-medium text-[var(--foreground)]">
                    {FIELD_LABELS[field] ?? field}:
                  </span>
                  <span className="text-red-500 line-through text-xs">
                    {formatValue(field, change.from, entry.closerNames)}
                  </span>
                  <span className="text-[var(--muted-foreground)]">&rarr;</span>
                  <span className="text-emerald-600 text-xs">
                    {formatValue(field, change.to, entry.closerNames)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
