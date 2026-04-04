'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Mail,
  Plus,
  Search,
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
import { TooltipProvider } from '@/shared/components/ui/tooltip';

import type { AutoEmailCadenceMetrics } from '../cadences.contract';
import type { CadenceTabCounts } from '../actions/fetch-cadences';
import { activateCadence, deleteCadence, duplicateCadence, updateCadence } from '../actions/manage-cadences';
import type { CadenceRow, CadenceType } from '../types';
import { AutoEmailTable } from './AutoEmailTable';
import { CadenceTableRow } from './CadenceTableRow';

interface CadenceListViewProps {
  cadences: CadenceRow[];
  total: number;
  page: number;
  perPage: number;
  tabCounts: CadenceTabCounts;
  metrics?: Record<string, AutoEmailCadenceMetrics>;
  userMap?: Record<string, string>;
  avatarMap?: Record<string, string>;
  members?: { userId: string; name: string }[];
  enrollmentCounts?: Record<string, number>;
}

const ALL_VALUE = '__all__';

export function CadenceListView({ cadences, total, page, perPage, tabCounts, metrics, userMap = {}, avatarMap = {}, members, enrollmentCounts = {} }: CadenceListViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const activeTab = (searchParams.get('type') ?? 'standard') as CadenceType;
  const [pendingTab, setPendingTab] = useState<CadenceType | null>(null);
  const displayTab = pendingTab ?? activeTab;

  // Search with debounce
  const currentSearch = searchParams.get('search') ?? '';
  const [searchValue, setSearchValue] = useState(currentSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Optimistic overrides for instant Select feedback
  const paramsKey = searchParams.toString();
  const [lastParamsKey, setLastParamsKey] = useState(paramsKey);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  if (paramsKey !== lastParamsKey) {
    setLastParamsKey(paramsKey);
    setOverrides({});
    setPendingTab(null);
    setSearchValue(searchParams.get('search') ?? '');
  }

  const activeStatus = overrides.status ?? (searchParams.get('status') ?? ALL_VALUE);
  const activePriority = overrides.priority ?? (searchParams.get('priority') ?? ALL_VALUE);
  const activeOrigin = overrides.origin ?? (searchParams.get('origin') ?? ALL_VALUE);
  const activeCreatedBy = overrides.created_by ?? (searchParams.get('created_by') ?? ALL_VALUE);

  function handleFilterChange(key: string, value: string) {
    setOverrides((prev) => ({ ...prev, [key]: value }));
    updateParams({ [key]: value });
  }

  const hasFilters = !!(searchParams.get('search') || searchParams.get('status') || searchParams.get('priority') || searchParams.get('origin') || searchParams.get('created_by'));
  const currentSortBy = searchParams.get('sort_by') ?? 'created_at';
  const currentSortDir = searchParams.get('sort_dir') ?? 'desc';

  function handleSort(column: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (currentSortBy === column) {
      params.set('sort_dir', currentSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      params.set('sort_by', column);
      params.set('sort_dir', column === 'name' ? 'asc' : 'desc');
    }
    params.set('page', '1');
    startTransition(() => {
      router.push(`/cadences?${params.toString()}`);
    });
  }

  function sortIcon(column: string) {
    if (currentSortBy !== column) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
    if (currentSortDir === 'asc') return <ArrowUp className="ml-1 h-3 w-3" />;
    return <ArrowDown className="ml-1 h-3 w-3" />;
  }

  // Note: optimistic state sync happens via paramsKey comparison above

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
                : 'border-transparent text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-[var(--foreground)]'
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
                : 'border-transparent text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-[var(--foreground)]'
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
            value={searchValue}
            className="h-9 pl-9"
            onChange={(e) => {
              const v = e.target.value;
              setSearchValue(v);
              if (debounceRef.current) clearTimeout(debounceRef.current);
              debounceRef.current = setTimeout(() => {
                updateParams({ search: v });
              }, 400);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (debounceRef.current) clearTimeout(debounceRef.current);
                updateParams({ search: searchValue });
              }
            }}
          />
        </div>
        <Select
          value={activeStatus}
          onValueChange={(v) => handleFilterChange('status', v)}
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
          value={activePriority}
          onValueChange={(v) => handleFilterChange('priority', v)}
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
          value={activeOrigin}
          onValueChange={(v) => handleFilterChange('origin', v)}
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
            value={activeCreatedBy}
            onValueChange={(v) => handleFilterChange('created_by', v)}
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
          avatarMap={avatarMap}
          onDeleteRequest={(id) => setDeleteId(id)}
        />
      ) : (
        <TooltipProvider>
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            {/* Table header */}
            <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--muted)]/50 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-[var(--foreground)]">
              <div className="w-7 shrink-0" />
              <div className="w-6 shrink-0" />
              <div className="w-48 shrink-0">
                <button type="button" className="flex items-center hover:text-[var(--primary)]" onClick={() => handleSort('name')}>
                  Nome {sortIcon('name')}
                </button>
              </div>
              <div className="min-w-0 flex-1">Descrição</div>
              <div className="w-20 shrink-0 text-center">Status</div>
              <div className="w-16 shrink-0 text-center">Passos</div>
              <div className="w-16 shrink-0 text-center">Leads</div>
              <div className="w-28 shrink-0">
                <button type="button" className="flex items-center hover:text-[var(--primary)]" onClick={() => handleSort('created_at')}>
                  Criada por {sortIcon('created_at')}
                </button>
              </div>
              <div className="w-8 shrink-0" />
              <div className="w-8 shrink-0" />
            </div>

            {/* Table rows */}
            {cadences.map((cadence, index) => (
              <CadenceTableRow
                key={cadence.id}
                cadence={cadence}
                isLast={index === cadences.length - 1}
                enrollmentCount={enrollmentCounts[cadence.id] ?? 0}
                creatorName={cadence.created_by ? (userMap[cadence.created_by] ?? '—') : '—'}
                onToggleStatus={handleToggleStatus}
                onArchive={handleArchive}
                onActivateDraft={handleActivateDraft}
                onDuplicate={handleDuplicate}
                onDeleteRequest={setDeleteId}
              />
            ))}
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
              A cadência será excluída permanentemente. Todos os leads ativos nesta cadência terão seus enrollments encerrados e não receberão mais mensagens automáticas. Esta ação não pode ser desfeita.
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
