'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import {
  Archive,
  BarChart3,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { LeadAvatar } from '@/features/leads/components/LeadAvatar';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Switch } from '@/shared/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import { Badge } from '@/shared/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

import type { AutoEmailCadenceMetrics } from '../cadences.contract';
import { activateCadence, createCadence, updateCadence } from '../actions/manage-cadences';
import type { CadenceRow } from '../types';

interface AutoEmailTableProps {
  cadences: CadenceRow[];
  metrics: Record<string, AutoEmailCadenceMetrics>;
  userMap?: Record<string, string>;
  onDeleteRequest: (id: string) => void;
}

function getCreatorFirstName(userId: string | null, userMap: Record<string, string>): string {
  if (!userId) return '-';
  const fullName = userMap[userId];
  if (!fullName) return userId.substring(0, 2).toUpperCase();
  return fullName.split(' ')[0] ?? fullName;
}

function getCreatorInitial(userId: string | null, userMap: Record<string, string>): string {
  if (!userId) return '?';
  const fullName = userMap[userId];
  return (fullName?.[0] ?? userId[0] ?? '?').toUpperCase();
}

type HealthLevel = 'green' | 'yellow' | 'red' | 'gray';

function getCadenceHealth(m: AutoEmailCadenceMetrics | undefined): { level: HealthLevel; label: string; detail: string } {
  if (!m || m.sent === 0) {
    return { level: 'gray', label: 'Sem dados', detail: 'Nenhum envio registrado' };
  }
  const totalAttempts = m.sent + m.failed + m.bounced;
  const failRate = ((m.failed + m.bounced) / totalAttempts) * 100;

  if (failRate > 25) {
    return { level: 'red', label: 'Crítico', detail: `${failRate.toFixed(0)}% de falha (${m.failed + m.bounced} de ${totalAttempts})` };
  }
  if (failRate > 10) {
    return { level: 'yellow', label: 'Atenção', detail: `${failRate.toFixed(0)}% de falha (${m.failed + m.bounced} de ${totalAttempts})` };
  }
  return { level: 'green', label: 'Saudável', detail: `${failRate.toFixed(0)}% de falha (${m.failed + m.bounced} de ${totalAttempts})` };
}

const HEALTH_STYLES: Record<HealthLevel, string> = {
  green: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  yellow: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  gray: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300',
};

function MetricCell({ value, isPercent = false }: { value: number; isPercent?: boolean }) {
  const display = isPercent ? `${value.toFixed(1)}%` : value;
  return (
    <TableCell className={`text-center tabular-nums ${value === 0 ? 'text-muted-foreground' : ''}`}>
      {display}
    </TableCell>
  );
}

export function AutoEmailTable({ cadences, metrics, userMap = {}, onDeleteRequest }: AutoEmailTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleToggleStatus(cadence: CadenceRow) {
    startTransition(async () => {
      if (cadence.status === 'draft') {
        const result = await activateCadence(cadence.id);
        if (result.success) {
          toast.success('Cadência ativada');
          router.refresh();
        } else {
          toast.error(result.error);
        }
        return;
      }
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

  function handleDuplicate(cadence: CadenceRow) {
    startTransition(async () => {
      const result = await createCadence({
        name: `${cadence.name} (cópia)`,
        description: cadence.description,
      });
      if (result.success) {
        toast.success('Cadência duplicada');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (cadences.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)]">
    <Table>
      <TableHeader>
        <TableRow className="bg-[var(--muted)]/50">
          <TableHead className="w-12">Ativar</TableHead>
          <TableHead className="min-w-[200px]">Nome</TableHead>
          <TableHead className="w-20">Saúde</TableHead>
          <TableHead className="w-16">Criador</TableHead>
          <TableHead className="w-16 text-center">Ativo</TableHead>
          <TableHead className="w-16 text-center">Pausado</TableHead>
          <TableHead className="w-16 text-center">Enviados</TableHead>
          <TableHead className="w-20 text-center">Rejeitado</TableHead>
          <TableHead className="w-20 text-center">Bloqueado</TableHead>
          <TableHead className="w-20 text-center">Finalizado</TableHead>
          <TableHead className="w-20 text-center">Respondido</TableHead>
          <TableHead className="w-20 text-center">Responder %</TableHead>
          <TableHead className="w-24 text-center">Interessados %</TableHead>
          <TableHead className="w-12"></TableHead>
          <TableHead className="w-16">Fluxo</TableHead>
          <TableHead className="w-12">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cadences.map((cadence) => {
          const m = metrics[cadence.id];
          const isActive = cadence.status === 'active';
          const canToggle = cadence.status !== 'archived';

          return (
            <TableRow key={cadence.id}>
              {/* Toggle */}
              <TableCell>
                <Switch
                  size="sm"
                  checked={isActive}
                  disabled={!canToggle || isPending}
                  onCheckedChange={() => handleToggleStatus(cadence)}
                  aria-label={`${isActive ? 'Pausar' : 'Ativar'} ${cadence.name}`}
                />
              </TableCell>

              {/* Name */}
              <TableCell>
                <button
                  type="button"
                  className="max-w-[250px] truncate text-left font-medium hover:underline"
                  onClick={() => router.push(`/cadences/${cadence.id}`)}
                >
                  {cadence.name}
                </button>
              </TableCell>

              {/* Health badge */}
              <TableCell>
                {(() => {
                  const health = getCadenceHealth(m);
                  return (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className={`text-xs ${HEALTH_STYLES[health.level]}`}>
                            {health.label}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">{health.detail}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })()}
              </TableCell>

              {/* Created by */}
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <LeadAvatar name={userMap[cadence.created_by ?? ''] ?? null} size="sm" />
                  <span className="text-xs">{getCreatorFirstName(cadence.created_by, userMap)}</span>
                </div>
              </TableCell>

              {/* Metrics */}
              <MetricCell value={m?.active ?? 0} />
              <MetricCell value={m?.paused ?? 0} />
              <MetricCell value={m?.sent ?? 0} />
              <MetricCell value={m?.bounced ?? 0} />
              <MetricCell value={m?.failed ?? 0} />
              <MetricCell value={m?.completed ?? 0} />
              <MetricCell value={m?.replied ?? 0} />
              <MetricCell value={m?.replyRate ?? 0} isPercent />
              <MetricCell value={m?.openRate ?? 0} isPercent />

              {/* Performance link */}
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => router.push(`/cadences/${cadence.id}/performance`)}
                  aria-label={`Performance de ${cadence.name}`}
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                </Button>
              </TableCell>

              {/* Workflow link */}
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => router.push(`/cadences/${cadence.id}`)}
                  aria-label={`Ver fluxo de ${cadence.name}`}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </TableCell>

              {/* Actions */}
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Ações para ${cadence.name}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => router.push(`/cadences/${cadence.id}`)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Editar
                    </DropdownMenuItem>
                    {cadence.status === 'draft' && cadence.total_steps >= 2 && (
                      <DropdownMenuItem onClick={() => handleToggleStatus(cadence)}>
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
                      onClick={() => onDeleteRequest(cadence.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Deletar
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
  );
}
