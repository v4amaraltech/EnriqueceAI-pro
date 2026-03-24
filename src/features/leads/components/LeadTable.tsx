'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Archive, ArrowDown, ArrowUp, ArrowUpDown, Download, Globe, MoreHorizontal, Pause, Pencil, Play, RefreshCw, Tag, Trash2, UserCheck, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import { bulkArchiveLeads, bulkAssignLeads, bulkChangeStatus, bulkDeleteLeads, bulkEnrichApollo, bulkEnrichLeads, bulkPauseEnrollments, bulkResumeEnrollments, exportLeadsCsv } from '../actions/bulk-actions';
import { fetchFilteredLeadIds } from '../actions/fetch-leads';
import { fetchOrgMembersAuth, type OrgMemberOption } from '../actions/fetch-org-members';
import type { LeadCadenceInfo, LeadRow } from '../types';
import { formatCnpj } from '../utils/cnpj';
import { EnrollInCadenceDialog } from './EnrollInCadenceDialog';
import { EngagementScoreBadge } from './EngagementScoreBadge';
import { LeadAvatar } from './LeadAvatar';
import { LeadSourceBadge, LeadStatusBadge } from './LeadStatusBadge';
import { AssignDialog, ConfirmDialog, EnrichConfirmDialog, StatusDialog } from './LeadTableDialogs';

interface LeadTableProps {
  leads: LeadRow[];
  total: number;
  cadenceInfo: Record<string, LeadCadenceInfo>;
  userMap: Record<string, string>;
}

type SortColumn = 'created_at' | 'nome_fantasia' | 'status' | 'engagement_score';

function SortIcon({ column, currentSort, currentDir }: { column: SortColumn; currentSort: SortColumn; currentDir: string }) {
  if (currentSort !== column) return <ArrowUpDown className="ml-1 h-3.5 w-3.5 opacity-40" />;
  if (currentDir === 'asc') return <ArrowUp className="ml-1 h-3.5 w-3.5" />;
  return <ArrowDown className="ml-1 h-3.5 w-3.5" />;
}

export function LeadTable({ leads, total, cadenceInfo, userMap }: LeadTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [showEnrollDialog, setShowEnrollDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showEnrichConfirm, setShowEnrichConfirm] = useState<'cnpj' | 'apollo' | null>(null);
  const [singleArchiveId, setSingleArchiveId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [statusTarget, setStatusTarget] = useState('');
  const [assignMembers, setAssignMembers] = useState<OrgMemberOption[]>([]);
  const [assignTarget, setAssignTarget] = useState('');

  const currentSortBy = (searchParams.get('sort_by') ?? 'created_at') as SortColumn;
  const currentSortDir = searchParams.get('sort_dir') ?? 'desc';

  const allSelected = leads.length > 0 && selected.size === leads.length;
  const someSelected = selected.size > 0 && selected.size < leads.length;

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
      setAllFilteredSelected(false);
    } else {
      setSelected(new Set(leads.map((l) => l.id)));
    }
  }, [allSelected, leads]);

  const toggleOne = useCallback((id: string) => {
    setAllFilteredSelected(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAllFiltered = useCallback(() => {
    const filters: Record<string, unknown> = {};
    searchParams.forEach((value, key) => {
      if (key !== 'page') filters[key] = value;
    });
    startTransition(async () => {
      const result = await fetchFilteredLeadIds(filters);
      if (result.success) {
        setSelected(new Set(result.data));
        setAllFilteredSelected(true);
      } else {
        toast.error(result.error);
      }
    });
  }, [searchParams]);

  const showSelectAllBanner = allSelected && total > leads.length && !allFilteredSelected;

  const handleSort = useCallback((column: SortColumn) => {
    const params = new URLSearchParams(searchParams.toString());
    if (currentSortBy === column) {
      params.set('sort_dir', currentSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      params.set('sort_by', column);
      params.set('sort_dir', 'desc');
    }
    params.delete('page');
    router.push(`/leads?${params.toString()}`);
  }, [router, searchParams, currentSortBy, currentSortDir]);

  const handleArchiveConfirmed = useCallback(() => {
    const ids = Array.from(selected);
    startTransition(async () => {
      const result = await bulkArchiveLeads(ids);
      if (result.success) {
        toast.success(`${result.data.count} leads arquivados`);
        setSelected(new Set());
        setShowArchiveConfirm(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [selected, router]);

  const handleDeleteConfirmed = useCallback(() => {
    const ids = Array.from(selected);
    startTransition(async () => {
      const result = await bulkDeleteLeads(ids);
      if (result.success) {
        toast.success(`${result.data.count} lead${result.data.count > 1 ? 's' : ''} excluído${result.data.count > 1 ? 's' : ''}`);
        setSelected(new Set());
        setShowDeleteConfirm(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [selected, router]);

  const handleEnrich = useCallback(() => {
    const ids = Array.from(selected);
    startTransition(async () => {
      const result = await bulkEnrichLeads(ids);
      if (result.success) {
        toast.success(`${result.data.successCount} enriquecidos, ${result.data.failCount} falharam`);
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [selected, router]);

  const handleEnrichApollo = useCallback(() => {
    const ids = Array.from(selected);
    startTransition(async () => {
      const result = await bulkEnrichApollo(ids);
      if (result.success) {
        const { successCount, failCount, skippedCount } = result.data;
        const parts: string[] = [];
        if (successCount > 0) parts.push(`${successCount} enriquecidos`);
        if (skippedCount > 0) parts.push(`${skippedCount} já enriquecidos`);
        if (failCount > 0) parts.push(`${failCount} falharam`);
        toast.success(parts.join(', '));
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [selected, router]);

  const handleExport = useCallback(() => {
    const ids = Array.from(selected);
    startTransition(async () => {
      const result = await exportLeadsCsv(ids);
      if (result.success) {
        const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.data.filename;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('CSV exportado');
      } else {
        toast.error(result.error);
      }
    });
  }, [selected]);

  const handleSingleEnrich = useCallback((id: string) => {
    startTransition(async () => {
      const result = await bulkEnrichLeads([id]);
      if (result.success) {
        toast.success('Enriquecimento iniciado');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [router]);

  const handleSingleEnrichApollo = useCallback((id: string) => {
    startTransition(async () => {
      const result = await bulkEnrichApollo([id]);
      if (result.success) {
        toast.success('Enriquecimento Apollo iniciado');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [router]);

  const handleSingleArchiveConfirmed = useCallback(() => {
    if (!singleArchiveId) return;
    startTransition(async () => {
      const result = await bulkArchiveLeads([singleArchiveId]);
      if (result.success) {
        toast.success('Lead arquivado');
        setSingleArchiveId(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [singleArchiveId, router]);

  const handleOpenAssignDialog = useCallback(() => {
    setShowAssignDialog(true);
    setAssignTarget('');
    fetchOrgMembersAuth().then((res) => {
      if (res.success) setAssignMembers(res.data);
    });
  }, []);

  const handleAssign = useCallback(() => {
    if (!assignTarget) return;
    const ids = Array.from(selected);
    startTransition(async () => {
      const result = await bulkAssignLeads(ids, assignTarget);
      if (result.success) {
        toast.success(`${result.data.count} lead${result.data.count > 1 ? 's' : ''} reatribuído${result.data.count > 1 ? 's' : ''}`);
        setSelected(new Set());
        setShowAssignDialog(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [assignTarget, selected, router]);

  const handleBulkStatusChange = useCallback(() => {
    if (!statusTarget) return;
    const ids = Array.from(selected);
    startTransition(async () => {
      const result = await bulkChangeStatus(ids, statusTarget as 'new' | 'contacted' | 'qualified' | 'unqualified');
      if (result.success) {
        toast.success(`${result.data.count} lead${result.data.count > 1 ? 's' : ''} atualizado${result.data.count > 1 ? 's' : ''}`);
        setSelected(new Set());
        setShowStatusDialog(false);
        setStatusTarget('');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [statusTarget, selected, router]);

  const handleBulkPause = useCallback(() => {
    const ids = Array.from(selected);
    startTransition(async () => {
      const result = await bulkPauseEnrollments(ids);
      if (result.success) {
        const count = result.data.count;
        toast.success(count > 0 ? `${count} inscrição${count > 1 ? 'ões' : ''} pausada${count > 1 ? 's' : ''}` : 'Nenhuma inscrição ativa encontrada');
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [selected, router]);

  const handleBulkResume = useCallback(() => {
    const ids = Array.from(selected);
    startTransition(async () => {
      const result = await bulkResumeEnrollments(ids);
      if (result.success) {
        const count = result.data.count;
        toast.success(count > 0 ? `${count} inscrição${count > 1 ? 'ões' : ''} retomada${count > 1 ? 's' : ''}` : 'Nenhuma inscrição pausada encontrada');
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [selected, router]);

  const navigateToLead = useCallback(
    (id: string) => {
      router.push(`/leads/${id}`);
    },
    [router],
  );

  return (
    <div className="space-y-3">
      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex flex-col gap-1">
          {showSelectAllBanner && (
            <div className="flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] p-2 text-sm">
              <span>Todos os {leads.length} leads desta página estão selecionados.</span>
              <button
                type="button"
                className="font-semibold text-[var(--primary)] underline-offset-2 hover:underline"
                onClick={handleSelectAllFiltered}
                disabled={isPending}
              >
                Selecionar todos os {total} leads dos filtros
              </button>
            </div>
          )}
          {allFilteredSelected && (
            <div className="flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] p-2 text-sm">
              <span>Todos os {selected.size} leads dos filtros estão selecionados.</span>
              <button
                type="button"
                className="font-semibold text-[var(--primary)] underline-offset-2 hover:underline"
                onClick={() => {
                  setSelected(new Set(leads.map((l) => l.id)));
                  setAllFilteredSelected(false);
                }}
              >
                Limpar seleção
              </button>
            </div>
          )}
        <div className="flex items-center gap-2 rounded-md bg-[var(--muted)] p-2">
          <span className="text-sm font-medium">
            {selected.size} lead{selected.size > 1 ? 's' : ''} selecionado{selected.size > 1 ? 's' : ''}
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEnrichConfirm('cnpj')}
              disabled={isPending}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              Enriquecer (CNPJ)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEnrichConfirm('apollo')}
              disabled={isPending}
            >
              <Globe className="mr-1 h-3.5 w-3.5" />
              Enriquecer (Apollo)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEnrollDialog(true)}
              disabled={isPending}
            >
              <Zap className="mr-1 h-3.5 w-3.5" />
              Cadência
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowStatusDialog(true); setStatusTarget(''); }}
              disabled={isPending}
            >
              <Tag className="mr-1 h-3.5 w-3.5" />
              Status
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkPause}
              disabled={isPending}
            >
              <Pause className="mr-1 h-3.5 w-3.5" />
              Pausar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkResume}
              disabled={isPending}
            >
              <Play className="mr-1 h-3.5 w-3.5" />
              Retomar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenAssignDialog}
              disabled={isPending}
            >
              <UserCheck className="mr-1 h-3.5 w-3.5" />
              Reatribuir
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowArchiveConfirm(true)}
              disabled={isPending}
            >
              <Archive className="mr-1 h-3.5 w-3.5" />
              Arquivar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isPending}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Excluir
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={isPending}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              Exportar CSV
            </Button>
          </div>
        </div>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                  aria-label="Selecionar todos"
                />
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  className="flex items-center font-medium hover:text-[var(--foreground)]"
                  onClick={() => handleSort('nome_fantasia')}
                >
                  Lead
                  <SortIcon column="nome_fantasia" currentSort={currentSortBy} currentDir={currentSortDir} />
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  className="flex items-center font-medium hover:text-[var(--foreground)]"
                  onClick={() => handleSort('status')}
                >
                  Status
                  <SortIcon column="status" currentSort={currentSortBy} currentDir={currentSortDir} />
                </button>
              </TableHead>
              <TableHead className="w-[70px]">
                <button
                  type="button"
                  className="flex items-center font-medium hover:text-[var(--foreground)]"
                  onClick={() => handleSort('engagement_score')}
                >
                  Engajamento
                  <SortIcon column="engagement_score" currentSort={currentSortBy} currentDir={currentSortDir} />
                </button>
              </TableHead>
              <TableHead>Cadência</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead className="w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => {
              const isSelected = selected.has(lead.id);
              const info = cadenceInfo[lead.id];
              const firstSocio = lead.socios?.[0];
              const contactName = lead.first_name ? `${lead.first_name} ${lead.last_name ?? ''}`.trim() : null;
              const personName = contactName ?? firstSocio?.nome ?? null;
              const companyName = lead.nome_fantasia ?? lead.razao_social ?? null;
              const primaryName = personName ?? companyName ?? (lead.cnpj ? formatCnpj(lead.cnpj) : 'Lead sem nome');
              const secondaryName = personName ? companyName : null;
              const responsible = userMap[lead.assigned_to ?? ''] ?? userMap[lead.created_by ?? ''] ?? null;

              return (
                <TableRow
                  key={lead.id}
                  data-state={isSelected ? 'selected' : undefined}
                  className="cursor-pointer"
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOne(lead.id)}
                      aria-label={`Selecionar ${primaryName}`}
                    />
                  </TableCell>
                  <TableCell
                    className="font-medium"
                    onClick={() => navigateToLead(lead.id)}
                  >
                    <div className="flex items-center gap-3">
                      <LeadAvatar name={primaryName} size="sm" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold">{primaryName}</span>
                          <LeadSourceBadge source={lead.lead_source} />
                        </div>
                        {secondaryName && (
                          <div className="truncate text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                            {secondaryName}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell onClick={() => navigateToLead(lead.id)}>
                    <LeadStatusBadge status={lead.status} variant="meetime" />
                  </TableCell>
                  <TableCell onClick={() => navigateToLead(lead.id)}>
                    <EngagementScoreBadge score={lead.engagement_score} size={28} />
                  </TableCell>
                  <TableCell onClick={() => navigateToLead(lead.id)}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">
                        {info?.cadence_name ?? '—'}
                      </span>
                      {info?.enrollment_status && (
                        <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${
                          info.enrollment_status === 'active'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        }`}>
                          {info.enrollment_status === 'active' ? 'Ativo' : 'Pausado'}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell onClick={() => navigateToLead(lead.id)}>
                    <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                      {responsible ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Ações</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigateToLead(lead.id)}>
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleSingleEnrich(lead.id)}>
                          <RefreshCw className="mr-2 h-3.5 w-3.5" />
                          Enriquecer (CNPJ)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleSingleEnrichApollo(lead.id)}>
                          <Globe className="mr-2 h-3.5 w-3.5" />
                          Enriquecer (Apollo)
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setSingleArchiveId(lead.id)}>
                          <Archive className="mr-2 h-3.5 w-3.5" />
                          Arquivar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Confirmation dialogs */}
      <ConfirmDialog
        open={showArchiveConfirm}
        onOpenChange={setShowArchiveConfirm}
        title="Arquivar leads"
        description={`Tem certeza que deseja arquivar ${selected.size} lead${selected.size > 1 ? 's' : ''}? Os leads arquivados não aparecerão mais na lista principal.`}
        confirmLabel="Arquivar"
        pendingLabel="Arquivando..."
        onConfirm={handleArchiveConfirmed}
        isPending={isPending}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Excluir leads"
        description={`Tem certeza que deseja excluir ${selected.size} lead${selected.size > 1 ? 's' : ''}? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        pendingLabel="Excluindo..."
        onConfirm={handleDeleteConfirmed}
        isPending={isPending}
      />

      <EnrichConfirmDialog
        enrichType={showEnrichConfirm}
        onClose={() => setShowEnrichConfirm(null)}
        onConfirm={() => {
          if (showEnrichConfirm === 'cnpj') handleEnrich();
          else handleEnrichApollo();
          setShowEnrichConfirm(null);
        }}
        selectedSize={selected.size}
        isPending={isPending}
      />

      <ConfirmDialog
        open={!!singleArchiveId}
        onOpenChange={(open) => !open && setSingleArchiveId(null)}
        title="Arquivar lead"
        description="Tem certeza que deseja arquivar este lead? Ele não aparecerá mais na lista principal."
        confirmLabel="Arquivar"
        pendingLabel="Arquivando..."
        onConfirm={handleSingleArchiveConfirmed}
        isPending={isPending}
      />

      <AssignDialog
        open={showAssignDialog}
        onOpenChange={setShowAssignDialog}
        members={assignMembers}
        assignTarget={assignTarget}
        onTargetChange={setAssignTarget}
        onConfirm={handleAssign}
        selectedSize={selected.size}
        isPending={isPending}
      />

      <StatusDialog
        open={showStatusDialog}
        onOpenChange={setShowStatusDialog}
        statusTarget={statusTarget}
        onTargetChange={setStatusTarget}
        onConfirm={handleBulkStatusChange}
        selectedSize={selected.size}
        isPending={isPending}
      />

      {/* Enroll in cadence dialog */}
      <EnrollInCadenceDialog
        open={showEnrollDialog}
        onOpenChange={(open) => {
          setShowEnrollDialog(open);
          if (!open) {
            setSelected(new Set());
          }
        }}
        leadIds={Array.from(selected)}
      />

    </div>
  );
}
