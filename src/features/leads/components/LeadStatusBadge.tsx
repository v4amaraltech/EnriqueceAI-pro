'use client';

import { Badge } from '@/shared/components/ui/badge';

import type { EnrichmentStatus, LeadStatus } from '../types';

const statusConfig: Record<LeadStatus, { label: string; className: string }> = {
  new: { label: 'Novo', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' },
  contacted: { label: 'Contatado', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' },
  qualified: { label: 'Qualificado', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
  unqualified: { label: 'Não Qualificado', className: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300' },
  archived: { label: 'Arquivado', className: 'bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-300' },
};

// Meetime-style engagement labels
const meetimeConfig: Record<LeadStatus, { label: string; className: string }> = {
  new: { label: 'ESPERANDO INÍCIO', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  contacted: { label: 'ATIVO', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  qualified: { label: 'ATIVO', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  unqualified: { label: 'DESCARTADO', className: 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300' },
  archived: { label: 'ARQUIVADO', className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300' },
};

const enrichmentConfig: Record<EnrichmentStatus, { label: string; className: string }> = {
  pending: { label: 'Pendente', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  enriching: { label: 'Enriquecendo', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  enriched: { label: 'Enriquecido', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  enrichment_failed: { label: 'Falhou', className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
  not_found: { label: 'Não Encontrado', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' },
};

export function LeadStatusBadge({ status, variant = 'default' }: { status: LeadStatus; variant?: 'default' | 'meetime' }) {
  const config = variant === 'meetime' ? meetimeConfig[status] : statusConfig[status];
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}

export function EnrichmentStatusBadge({ status }: { status: EnrichmentStatus }) {
  const config = enrichmentConfig[status];
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}

export function LeadSourceBadge({ source }: { source: string | null }) {
  if (source !== 'apollo') return null;
  return (
    <Badge variant="outline" className="bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300 text-[10px] px-1.5 py-0">
      Apollo
    </Badge>
  );
}
