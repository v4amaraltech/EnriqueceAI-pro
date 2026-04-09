'use client';

import { useRouter } from 'next/navigation';
import {
  Archive,
  BarChart3,
  Copy,
  Info,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Trash2,
  Zap,
} from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

import type { CadenceRow, CadenceStatus } from '../types';
import { PriorityIcon } from './PriorityIcon';

const statusConfig: Record<CadenceStatus, { label: string; className: string }> = {
  draft: {
    label: 'Rascunho',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  active: {
    label: 'Ativa',
    className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  },
  paused: {
    label: 'Pausada',
    className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  },
  archived: {
    label: 'Arquivada',
    className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  },
};

interface CadenceTableRowProps {
  cadence: CadenceRow;
  isLast: boolean;
  enrollmentCount: number;
  creatorName: string;
  onToggleStatus: (cadence: CadenceRow) => void;
  onArchive: (cadence: CadenceRow) => void;
  onActivateDraft: (cadence: CadenceRow) => void;
  onDuplicate: (cadence: CadenceRow) => void;
  onDeleteRequest: (id: string) => void;
}

export function CadenceTableRow({
  cadence,
  isLast,
  enrollmentCount,
  creatorName,
  onToggleStatus,
  onArchive,
  onActivateDraft,
  onDuplicate,
  onDeleteRequest,
}: CadenceTableRowProps) {
  const router = useRouter();
  const config = statusConfig[cadence.status];

  return (
    <div
      className={`group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--muted)]/30 ${
        !isLast ? 'border-b border-[var(--border)]' : ''
      }`}
    >
      {/* Info icon */}
      <div className="w-7 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="Informações da cadência" className="text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-[var(--foreground)]">
              <Info className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs">
            <div className="space-y-1 text-xs">
              <p><span className="font-medium">Prioridade:</span> {cadence.priority === 'high' ? 'Alta' : cadence.priority === 'medium' ? 'Média' : 'Baixa'}</p>
              <p><span className="font-medium">Origem:</span> {cadence.origin === 'inbound_active' ? 'Inbound Ativo' : cadence.origin === 'inbound_passive' ? 'Inbound Passivo' : 'Outbound'}</p>
              <p><span className="font-medium">Criada:</span> {new Date(cadence.created_at).toLocaleDateString('pt-BR')}</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Priority arrow */}
      <div className="w-6 shrink-0">
        <PriorityIcon priority={cadence.priority} className="h-5 w-5" />
      </div>

      {/* Name + Description */}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => router.push(`/cadences/${cadence.id}`)}
          className="block w-full truncate text-left text-sm font-medium text-[var(--foreground)] hover:text-[var(--primary)] hover:underline"
        >
          {cadence.name}
        </button>
        {cadence.description && (
          <p className="truncate text-xs text-muted-foreground mt-0.5">
            {cadence.description}
          </p>
        )}
      </div>

      {/* Status badge */}
      <div className="w-20 shrink-0 text-center">
        <Badge variant="outline" className={`text-[10px] ${config.className}`}>
          {config.label}
        </Badge>
      </div>

      {/* Steps count */}
      <div className="w-16 shrink-0 text-center text-xs text-[var(--foreground)]">
        {cadence.total_steps} passo{cadence.total_steps !== 1 ? 's' : ''}
      </div>

      {/* Enrollment count */}
      <div className="w-16 shrink-0 text-center text-xs text-[var(--foreground)]">
        {enrollmentCount}
      </div>

      {/* Creator */}
      <div className="w-28 shrink-0 truncate text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        {creatorName}
      </div>

      {/* Performance link */}
      <div className="w-8 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
          onClick={() => router.push(`/cadences/${cadence.id}/performance`)}
          aria-label={`Performance de ${cadence.name}`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Actions menu */}
      <div className="w-8 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
              aria-label={`Ações para ${cadence.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push(`/cadences/${cadence.id}`)}>
              <Pencil className="mr-2 h-4 w-4" />
              Editar
            </DropdownMenuItem>
            {cadence.status === 'draft' && cadence.total_steps >= 2 && (
              <DropdownMenuItem onClick={() => onActivateDraft(cadence)}>
                <Zap className="mr-2 h-4 w-4" />
                Ativar
              </DropdownMenuItem>
            )}
            {(cadence.status === 'active' || cadence.status === 'paused') && (
              <DropdownMenuItem onClick={() => onToggleStatus(cadence)}>
                {cadence.status === 'active' ? (
                  <><Pause className="mr-2 h-4 w-4" />Pausar</>
                ) : (
                  <><Play className="mr-2 h-4 w-4" />Ativar</>
                )}
              </DropdownMenuItem>
            )}
            {cadence.status !== 'archived' && (
              <DropdownMenuItem onClick={() => onArchive(cadence)}>
                <Archive className="mr-2 h-4 w-4" />
                Arquivar
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onDuplicate(cadence)}>
              <Copy className="mr-2 h-4 w-4" />
              Duplicar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-red-600"
              onClick={() => onDeleteRequest(cadence.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Deletar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export { statusConfig };
