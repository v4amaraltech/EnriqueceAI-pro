'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import {
  Archive,
  BarChart3,
  Copy,
  Info,
  Mail,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

import type { AutoEmailCadenceMetrics } from '../cadences.contract';
import type { CadenceTabCounts } from '../actions/fetch-cadences';
import { activateCadence, deleteCadence, duplicateCadence, updateCadence } from '../actions/manage-cadences';
import type { CadenceRow, CadenceStatus, CadenceType } from '../types';
import { AutoEmailTable } from './AutoEmailTable';
import { PriorityIcon } from './PriorityIcon';

interface CadenceListViewProps {
  cadences: CadenceRow[];
  total: number;
  page: number;
  perPage: number;
  tabCounts: CadenceTabCounts;
  metrics?: Record<string, AutoEmailCadenceMetrics>;
  userMap?: Record<string, string>;
  members?: { userId: string; name: string }[];
}

const ALL_VALUE = '__all__';

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

export function CadenceListView({ cadences, total, page, perPage, tabCounts, metrics, userMap = {}, members }: CadenceListViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const activeTab = (searchParams.get('type') ?? 'standard') as CadenceType;
  const [pendingTab, setPendingTab] = useState<CadenceType | null>(null);
  const displayTab = pendingTab ?? activeTab;
  const hasFilters = !!(searchParams.get('search') || searchParams.get('status') || searchParams.get('priority') || searchParams.get('origin') || searchParams.get('created_by'));

  // Clear optimistic tab when URL catches up
  useEffect(() => {
    setPendingTab(null);
  }, [activeTab]);

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === ALL_VALUE) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    params.set('page', '1');
    startTransition(() => {
      router.push(`/cadences?${params.toString()}`);
    });
  }

  function handleTabChange(type: CadenceType) {
    setPendingTab(type);
    updateParams({ type: type === 'standard' ? '' : type });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteCadence(id);
      if (result.success) {
        toast.success('Cadência deletada');
        router.refresh();
      } else {
        toast.error(result.error);
      }
      setDeleteId(null);
    });
  }

  function handleToggleStatus(cadence: CadenceRow) {
    startTransition(async () => {
      const newStatus = cadence.status === 'active' ? 'paused' : 'active';
      const result = await updateCadence(cadence.id, { status: newStatus });
      if (result.success) {
        toast.success(newStatus === 'active' ? 'Cadência ativada' : 'Cadência pausada');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleArchive(cadence: CadenceRow) {
    startTransition(async () => {
      const result = await updateCadence(cadence.id, { status: 'archived' });
      if (result.success) {
        toast.success('Cadência arquivada');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleActivateDraft(cadence: CadenceRow) {
    startTransition(async () => {
      const result = await activateCadence(cadence.id);
      if (result.success) {
        toast.success('Cadência ativada');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDuplicate(cadence: CadenceRow) {
    startTransition(async () => {
      const result = await duplicateCadence(cadence.id);
      if (result.success) {
        toast.success('Cadência duplicada com todos os passos');
        router.push(`/cadences/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-4">
      {/* Status line */}
      <div className="flex items-center gap-2 text-sm text-[var(--foreground)]">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
        Exibindo {total === 1 ? '1 cadência' : `todas as ${total} cadências`}.
      </div>

      {/* Tabs + Create button */}
      <div className="flex items-center justify-between">
        <div className="flex gap-0 border-b border-[var(--border)]">
          <button
            type="button"
            onClick={() => handleTabChange('standard')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              displayTab === 'standard'
                ? 'border-[var(--primary)] text-[var(--foreground)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            Padrão
            <Badge variant="secondary" className="h-5 min-w-5 rounded-full px-1.5 text-xs">
              {tabCounts.standard}
            </Badge>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('auto_email')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              displayTab === 'auto_email'
                ? 'border-[var(--primary)] text-[var(--foreground)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            E-mail Automático
            <Badge variant="secondary" className="h-5 min-w-5 rounded-full px-1.5 text-xs">
              {tabCounts.auto_email}
            </Badge>
          </button>
        </div>

        {/* Create dropdown (Meetime-style) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Plus className="mr-2 h-4 w-4" />
              Criar nova
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuItem onClick={() => router.push('/cadences/new')}>
              <Zap className="mr-2 h-4 w-4 text-blue-500" />
              Cadência Padrão
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/cadences/new?type=auto_email')}>
              <Mail className="mr-2 h-4 w-4 text-purple-500" />
              Cadência Automática de E-mail
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome..."
            defaultValue={searchParams.get('search') ?? ''}
            className="h-9 pl-9"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateParams({ search: (e.target as HTMLInputElement).value });
              }
            }}
          />
        </div>
        <Select
          value={searchParams.get('status') ?? ALL_VALUE}
          onValueChange={(v) => updateParams({ status: v })}
        >
          <SelectTrigger className="h-9 w-32">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todos</SelectItem>
            <SelectItem value="draft">Rascunho</SelectItem>
            <SelectItem value="active">Ativa</SelectItem>
            <SelectItem value="paused">Pausada</SelectItem>
            <SelectItem value="archived">Arquivada</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={searchParams.get('priority') ?? ALL_VALUE}
          onValueChange={(v) => updateParams({ priority: v })}
        >
          <SelectTrigger className="h-9 w-32">
            <SelectValue placeholder="Prioridade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todas</SelectItem>
            <SelectItem value="high">Alta</SelectItem>
            <SelectItem value="medium">Média</SelectItem>
            <SelectItem value="low">Baixa</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={searchParams.get('origin') ?? ALL_VALUE}
          onValueChange={(v) => updateParams({ origin: v })}
        >
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder="Origem" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todas</SelectItem>
            <SelectItem value="inbound_active">Inbound Ativo</SelectItem>
            <SelectItem value="inbound_passive">Inbound Passivo</SelectItem>
            <SelectItem value="outbound">Outbound</SelectItem>
          </SelectContent>
        </Select>
        {members && members.length > 0 && (
          <Select
            value={searchParams.get('created_by') ?? ALL_VALUE}
            onValueChange={(v) => updateParams({ created_by: v })}
          >
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="Criada por" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs"
            onClick={() => router.push('/cadences')}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Cadence list */}
      <div className={isPending ? 'pointer-events-none opacity-50 transition-opacity' : ''}>
      {cadences.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 rounded-full bg-muted p-4">
            <Zap className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="mb-2 text-lg font-semibold">Nenhuma cadência encontrada</h3>
          <p className="mb-6 max-w-sm text-sm text-muted-foreground">
            Crie sua primeira cadência para automatizar o contato com leads.
          </p>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => router.push('/cadences/new')}
          >
            <Plus className="mr-2 h-4 w-4" />
            Criar Cadência
          </Button>
        </div>
      ) : activeTab === 'auto_email' && metrics ? (
        <AutoEmailTable
          cadences={cadences}
          metrics={metrics}
          userMap={userMap}
          onDeleteRequest={(id) => setDeleteId(id)}
        />
      ) : (
        <TooltipProvider>
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            {/* Table header */}
            <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--muted)]/50 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-[var(--foreground)]">
              <div className="w-7 shrink-0" />
              <div className="w-6 shrink-0" />
              <div className="w-48 shrink-0">Nome</div>
              <div className="min-w-0 flex-1">Descrição</div>
              <div className="w-20 shrink-0 text-center">Status</div>
              <div className="w-16 shrink-0 text-center">Passos</div>
              <div className="w-28 shrink-0">Criada por</div>
              <div className="w-8 shrink-0" />
              <div className="w-8 shrink-0" />
            </div>

            {/* Table rows */}
            {cadences.map((cadence, index) => {
              const config = statusConfig[cadence.status];
              return (
                <div
                  key={cadence.id}
                  className={`group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--muted)]/30 ${
                    index < cadences.length - 1 ? 'border-b border-[var(--border)]' : ''
                  }`}
                >
                  {/* Info icon */}
                  <div className="w-7 shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
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

                  {/* Name */}
                  <div className="w-48 shrink-0">
                    <button
                      type="button"
                      onClick={() => router.push(`/cadences/${cadence.id}`)}
                      className="truncate text-sm font-medium text-[var(--foreground)] hover:text-[var(--primary)] hover:underline"
                    >
                      {cadence.name}
                    </button>
                  </div>

                  {/* Description */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm italic text-[var(--foreground)]/80">
                      {cadence.description || ''}
                    </p>
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

                  {/* Creator */}
                  <div className="w-28 shrink-0 truncate text-xs text-[var(--muted-foreground)]">
                    {cadence.created_by ? (userMap[cadence.created_by] ?? '—') : '—'}
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
                          <DropdownMenuItem onClick={() => handleActivateDraft(cadence)}>
                            <Zap className="mr-2 h-4 w-4" />
                            Ativar
                          </DropdownMenuItem>
                        )}
                        {(cadence.status === 'active' || cadence.status === 'paused') && (
                          <DropdownMenuItem onClick={() => handleToggleStatus(cadence)}>
                            {cadence.status === 'active' ? (
                              <><Pause className="mr-2 h-4 w-4" />Pausar</>
                            ) : (
                              <><Play className="mr-2 h-4 w-4" />Ativar</>
                            )}
                          </DropdownMenuItem>
                        )}
                        {cadence.status !== 'archived' && (
                          <DropdownMenuItem onClick={() => handleArchive(cadence)}>
                            <Archive className="mr-2 h-4 w-4" />
                            Arquivar
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => handleDuplicate(cadence)}>
                          <Copy className="mr-2 h-4 w-4" />
                          Duplicar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => setDeleteId(cadence.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Deletar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        </TooltipProvider>
      )}

      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.set('page', String(page - 1));
              router.push(`/cadences?${params.toString()}`);
            }}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.set('page', String(page + 1));
              router.push(`/cadences?${params.toString()}`);
            }}
          >
            Próxima
          </Button>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deletar cadência</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja deletar esta cadência? Os enrollments ativos serão encerrados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => deleteId && handleDelete(deleteId)}
            >
              {isPending ? 'Deletando...' : 'Deletar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
