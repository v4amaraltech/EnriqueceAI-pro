'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Archive, ArrowDown, ArrowUp, ArrowUpDown, Download, Globe, MoreHorizontal, Pencil, RefreshCw, UserCheck, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import { bulkArchiveLeads, bulkAssignLeads, bulkEnrichApollo, bulkEnrichLeads, exportLeadsCsv } from '../actions/bulk-actions';
import { fetchOrgMembersAuth, type OrgMemberOption } from '../actions/fetch-org-members';
import type { LeadCadenceInfo, LeadRow } from '../types';
import { formatCnpj } from '../utils/cnpj';
import { EnrollInCadenceDialog } from './EnrollInCadenceDialog';
import { EngagementScoreBadge } from './EngagementScoreBadge';
import { LeadAvatar } from './LeadAvatar';
import { LeadSourceBadge, LeadStatusBadge } from './LeadStatusBadge';

interface LeadTableProps {
  leads: LeadRow[];
  cadenceInfo: Record<string, LeadCadenceInfo>;
  userMap: Record<string, string>;
}

type SortColumn = 'created_at';

function SortIcon({ column, currentSort, currentDir }: { column: SortColumn; currentSort: SortColumn; currentDir: string }) {
  if (currentSort !== column) return <ArrowUpDown className="ml-1 h-3.5 w-3.5 opacity-40" />;
  if (currentDir === 'asc') return <ArrowUp className="ml-1 h-3.5 w-3.5" />;
  return <ArrowDown className="ml-1 h-3.5 w-3.5" />;
}

export function LeadTable({ leads, cadenceInfo, userMap }: LeadTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [showEnrollDialog, setShowEnrollDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [assignMembers, setAssignMembers] = useState<OrgMemberOption[]>([]);
  const [assignTarget, setAssignTarget] = useState('');

  const currentSortBy = (searchParams.get('sort_by') ?? 'created_at') as SortColumn;
  const currentSortDir = searchParams.get('sort_dir') ?? 'desc';

  const allSelected = leads.length > 0 && selected.size === leads.length;
  const someSelected = selected.size > 0 && selected.size < leads.length;

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(leads.map((l) => l.id)));
    }
  }, [allSelected, leads]);

  const toggleOne = useCallback((id: string) => {
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

  const handleSingleArchive = useCallback((id: string) => {
    startTransition(async () => {
      const result = await bulkArchiveLeads([id]);
      if (result.success) {
        toast.success('Lead arquivado');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [router]);

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
        <div className="flex items-center gap-2 rounded-md bg-[var(--muted)] p-2">
          <span className="text-sm font-medium">
            {selected.size} lead{selected.size > 1 ? 's' : ''} selecionado{selected.size > 1 ? 's' : ''}
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleEnrich}
              disabled={isPending}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              Enriquecer (CNPJ)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleEnrichApollo}
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
              onClick={handleExport}
              disabled={isPending}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              Exportar CSV
            </Button>
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
              <TableHead>Lead</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[70px]">Engajamento</TableHead>
              <TableHead>
                <button
                  type="button"
                  className="flex items-center font-medium hover:text-[var(--foreground)]"
                  onClick={() => handleSort('created_at')}
                >
                  Cadência
                  <SortIcon column="created_at" currentSort={currentSortBy} currentDir={currentSortDir} />
                </button>
              </TableHead>
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
                          <div className="truncate text-xs text-[var(--muted-foreground)]">
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
                    <span className="text-sm">
                      {info?.cadence_name ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell onClick={() => navigateToLead(lead.id)}>
                    <span className="text-sm text-[var(--muted-foreground)]">
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
                        <DropdownMenuItem onClick={() => handleSingleArchive(lead.id)}>
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

      {/* Archive confirmation dialog */}
      <Dialog open={showArchiveConfirm} onOpenChange={setShowArchiveConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arquivar leads</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja arquivar {selected.size} lead{selected.size > 1 ? 's' : ''}? Os leads arquivados não aparecerão mais na lista principal.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowArchiveConfirm(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleArchiveConfirmed} disabled={isPending}>
              {isPending ? 'Arquivando...' : 'Arquivar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reatribuir leads</DialogTitle>
            <DialogDescription>
              Selecione o responsável para {selected.size} lead{selected.size > 1 ? 's' : ''}.
            </DialogDescription>
          </DialogHeader>
          <Select value={assignTarget} onValueChange={setAssignTarget}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um responsável" />
            </SelectTrigger>
            <SelectContent>
              {assignMembers.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAssign} disabled={!assignTarget || isPending}>
              {isPending ? 'Reatribuindo...' : 'Reatribuir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
