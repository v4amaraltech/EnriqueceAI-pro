'use client';

import { useEffect, useState, useTransition } from 'react';

import { Loader2, Lock, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Input } from '@/shared/components/ui/input';

import { getGoals } from '../actions/get-goals';
import { saveGoals } from '../actions/save-goals';
import type { UserGoalRow } from '../types';

interface GoalsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string; // YYYY-MM
}

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function getMonthName(month: string) {
  const m = parseInt(month.split('-')[1]!, 10);
  return MONTH_NAMES[m - 1]!;
}

function getPreviousMonthName(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const prevDate = new Date(y, m - 2, 1);
  return MONTH_NAMES[prevDate.getMonth()]!.toLowerCase();
}

function computeEstimate(
  opportunityTarget: number,
  conversionTarget: number,
  numSdrs: number,
) {
  if (conversionTarget <= 0 || numSdrs <= 0) return null;
  const leadsNeeded = Math.ceil(opportunityTarget / (conversionTarget / 100));
  const avgActivitiesPerLead = 8;
  const businessDays = 22;
  const activitiesPerDay = Math.ceil(
    (leadsNeeded * avgActivitiesPerLead) / businessDays / numSdrs,
  );
  return { leadsNeeded, activitiesPerDay };
}

export function GoalsModal({ open, onOpenChange, month }: GoalsModalProps) {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [opportunityTarget, setOpportunityTarget] = useState(0);
  const [leadsFinishedTarget, setLeadsFinishedTarget] = useState(0);
  const [activitiesTarget, setActivitiesTarget] = useState(0);
  const [conversionTarget, setConversionTarget] = useState(0);
  const [leadsOpenedTarget, setLeadsOpenedTarget] = useState(0);
  const [meetingsScheduledTarget, setMeetingsScheduledTarget] = useState(0);
  const [meetingsHeldTarget, setMeetingsHeldTarget] = useState(0);
  const [userGoals, setUserGoals] = useState<UserGoalRow[]>([]);
  const [visibleUserIds, setVisibleUserIds] = useState<Set<string>>(new Set());

  const monthName = getMonthName(month);
  const prevMonthName = getPreviousMonthName(month);
  const currentMonthLabel = `meta ${monthName.toLowerCase()}`;

  /* eslint-disable react-hooks/set-state-in-effect -- fetch-on-open pattern */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getGoals(month).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setOpportunityTarget(result.data.opportunityTarget);
        setLeadsFinishedTarget(result.data.leadsFinishedTarget);
        setActivitiesTarget(result.data.activitiesTarget);
        setConversionTarget(result.data.conversionTarget);
        setLeadsOpenedTarget(result.data.leadsOpenedTarget);
        setMeetingsScheduledTarget(result.data.meetingsScheduledTarget);
        setMeetingsHeldTarget(result.data.meetingsHeldTarget);
        setUserGoals(result.data.userGoals);

        // Show SDRs that already have goals or had goals last month; fallback to all
        const qualified = result.data.userGoals
          .filter((ug) => ug.opportunityTarget > 0 || ug.previousTarget !== null)
          .map((ug) => ug.userId);
        setVisibleUserIds(
          new Set(qualified.length > 0 ? qualified : result.data.userGoals.map((ug) => ug.userId)),
        );
      } else {
        toast.error(result.error);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, month]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const visibleGoals = userGoals.filter((ug) => visibleUserIds.has(ug.userId));
  const availableGoals = userGoals.filter((ug) => !visibleUserIds.has(ug.userId));

  function addSdrToList(userId: string) {
    setVisibleUserIds((prev) => new Set([...prev, userId]));
  }

  function updateUserGoal(userId: string, value: number) {
    setUserGoals((prev) =>
      prev.map((ug) => (ug.userId === userId ? { ...ug, opportunityTarget: value } : ug)),
    );
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveGoals({
        month,
        opportunityTarget,
        leadsFinishedTarget,
        activitiesTarget,
        conversionTarget,
        leadsOpenedTarget,
        meetingsScheduledTarget,
        meetingsHeldTarget,
        userGoals: userGoals.map((ug) => ({
          userId: ug.userId,
          opportunityTarget: ug.opportunityTarget,
        })),
      });

      if (result.success) {
        toast.success('Metas salvas com sucesso');
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  const estimate = computeEstimate(opportunityTarget, conversionTarget, userGoals.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl gap-0 overflow-hidden p-0" showCloseButton={false}>
        <DialogTitle className="sr-only">Metas {monthName}</DialogTitle>
        {/* Banner header */}
        <div className="flex items-center justify-between bg-[var(--primary)] px-6 py-5">
          <h2 className="text-lg font-bold text-[var(--primary-foreground)]">
            Metas {monthName}
          </h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-[var(--primary-foreground)] opacity-80 hover:opacity-100"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Fechar modal</span>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--foreground)] opacity-70" />
          </div>
        ) : (
          <div className="min-h-[60vh] max-h-[80vh] space-y-6 overflow-y-auto px-6 py-6">
            <p className="text-xs text-[var(--foreground)] opacity-50">
              Estas metas mensais são exibidas nos cards do Dashboard. Para metas diárias individuais, acesse Configurações &gt; Prospecção.
            </p>

            {/* Meta de Oportunidades */}
            <div className="rounded-lg border bg-[var(--card)] p-5">
              <div className="flex items-center justify-between gap-6">
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Meta de Oportunidades</p>
                  <p className="mt-1 text-sm text-[var(--foreground)] opacity-70">
                    Número total de oportunidades para o mês
                  </p>
                </div>
                <div className="relative w-24 shrink-0">
                  <Input
                    id="opportunity-target"
                    type="number"
                    min={0}
                    className="text-right text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    value={opportunityTarget}
                    onChange={(e) => setOpportunityTarget(Number(e.target.value) || 0)}
                    aria-label="Meta de Oportunidades"
                  />
                </div>
              </div>
            </div>

            {/* Meta de Leads Finalizados */}
            <div className="rounded-lg border bg-[var(--card)] p-5">
              <div className="flex items-center justify-between gap-6">
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Meta de Leads Finalizados</p>
                  <p className="mt-1 text-sm text-[var(--foreground)] opacity-70">
                    Total de leads finalizados (prospectados) pela equipe no mês
                  </p>
                </div>
                <div className="relative w-24 shrink-0">
                  <Input
                    id="leads-finished-target"
                    type="number"
                    min={0}
                    className="text-right text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    value={leadsFinishedTarget}
                    onChange={(e) => setLeadsFinishedTarget(Number(e.target.value) || 0)}
                    aria-label="Meta de Leads Finalizados"
                  />
                </div>
              </div>
            </div>

            {/* Meta de Leads Abertos */}
            <div className="rounded-lg border bg-[var(--card)] p-5">
              <div className="flex items-center justify-between gap-6">
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Meta de Leads Abertos</p>
                  <p className="mt-1 text-sm text-[var(--foreground)] opacity-70">
                    Total de leads que o time vai abrir no mês (primeiro contato humano por email, WhatsApp, telefone, LinkedIn ou pesquisa)
                  </p>
                </div>
                <div className="relative w-24 shrink-0">
                  <Input
                    id="leads-opened-target"
                    type="number"
                    min={0}
                    className="text-right text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    value={leadsOpenedTarget}
                    onChange={(e) => setLeadsOpenedTarget(Number(e.target.value) || 0)}
                    aria-label="Meta de Leads Abertos"
                  />
                </div>
              </div>
            </div>

            {/* Meta de Reuniões Marcadas */}
            <div className="rounded-lg border bg-[var(--card)] p-5">
              <div className="flex items-center justify-between gap-6">
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Meta de Reuniões Marcadas</p>
                  <p className="mt-1 text-sm text-[var(--foreground)] opacity-70">
                    Total de reuniões agendadas no mês (campo meeting_scheduled_at do lead)
                  </p>
                </div>
                <div className="relative w-24 shrink-0">
                  <Input
                    id="meetings-scheduled-target"
                    type="number"
                    min={0}
                    className="text-right text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    value={meetingsScheduledTarget}
                    onChange={(e) => setMeetingsScheduledTarget(Number(e.target.value) || 0)}
                    aria-label="Meta de Reuniões Marcadas"
                  />
                </div>
              </div>
            </div>

            {/* Meta de Reuniões Realizadas */}
            <div className="rounded-lg border bg-[var(--card)] p-5">
              <div className="flex items-center justify-between gap-6">
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Meta de Reuniões Realizadas</p>
                  <p className="mt-1 text-sm text-[var(--foreground)] opacity-70">
                    Total de reuniões realizadas no mês (leads marcados como ganhos)
                  </p>
                </div>
                <div className="relative w-24 shrink-0">
                  <Input
                    id="meetings-held-target"
                    type="number"
                    min={0}
                    className="text-right text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    value={meetingsHeldTarget}
                    onChange={(e) => setMeetingsHeldTarget(Number(e.target.value) || 0)}
                    aria-label="Meta de Reuniões Realizadas"
                  />
                </div>
              </div>
            </div>

            {/* Meta de Atividades Realizadas */}
            <div className="rounded-lg border bg-[var(--card)] p-5">
              <div className="flex items-center justify-between gap-6">
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Meta de Atividades</p>
                  <p className="mt-1 text-sm text-[var(--foreground)] opacity-70">
                    Total de atividades (emails, ligações, etc.) que a equipe deve realizar no mês
                  </p>
                </div>
                <div className="relative w-24 shrink-0">
                  <Input
                    id="activities-target"
                    type="number"
                    min={0}
                    className="text-right text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    value={activitiesTarget}
                    onChange={(e) => setActivitiesTarget(Number(e.target.value) || 0)}
                    aria-label="Meta de Atividades"
                  />
                </div>
              </div>
            </div>

            {/* Meta de Taxa de Conversão */}
            <div className="rounded-lg border bg-[var(--card)] p-5">
              <div className="flex items-center justify-between gap-6">
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Meta de Taxa de Conversão</p>
                  <p className="mt-1 text-sm text-[var(--foreground)] opacity-70">
                    Percentual dos leads finalizados no mês que a empresa espera transformar em oportunidades
                  </p>
                </div>
                <div className="relative w-24 shrink-0">
                  <Input
                    id="conversion-target"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    className="pr-8 text-right text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    value={conversionTarget}
                    onChange={(e) => setConversionTarget(Number(e.target.value) || 0)}
                    aria-label="Taxa de Conversão"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-[var(--foreground)] opacity-70">
                    %
                  </span>
                </div>
              </div>
            </div>

            {/* Vendedores */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">
                  Vendedores ({visibleGoals.length})
                </h3>
                {availableGoals.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-full border bg-[var(--card)] text-[var(--foreground)] opacity-70 shadow-sm hover:bg-[var(--accent)]"
                        aria-label="Adicionar vendedor"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>Adicionar vendedor</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {availableGoals.map((ug) => (
                        <DropdownMenuItem
                          key={ug.userId}
                          onClick={() => addSdrToList(ug.userId)}
                          className="gap-3"
                        >
                          <Avatar className="h-6 w-6">
                            {ug.avatarUrl && <AvatarImage src={ug.avatarUrl} alt={ug.userName} />}
                            <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                              {ug.userName.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          {ug.userName}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {visibleGoals.length > 0 && (
                <div className="space-y-2">
                  {visibleGoals.map((ug) => (
                    <div
                      key={ug.userId}
                      className="flex items-center gap-4 rounded-lg border bg-[var(--card)] px-4 py-3"
                    >
                      {/* Avatar */}
                      <Avatar>
                        {ug.avatarUrl && <AvatarImage src={ug.avatarUrl} alt={ug.userName} />}
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                          {ug.userName.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                        </AvatarFallback>
                      </Avatar>

                      {/* Nome */}
                      <span className="flex-1 text-sm font-medium">{ug.userName}</span>

                      {/* Mês anterior */}
                      <div className="text-center">
                        <p className="text-xs text-[var(--foreground)] opacity-70">{prevMonthName}</p>
                        <p className="text-sm text-[var(--foreground)] opacity-70">
                          {ug.previousTarget !== null ? ug.previousTarget : '–'}
                        </p>
                      </div>

                      {/* Meta atual */}
                      <div className="text-center">
                        <p className="text-xs text-[var(--foreground)] opacity-70">{currentMonthLabel}</p>
                        <Input
                          type="number"
                          min={0}
                          className="w-20 text-center text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          value={ug.opportunityTarget}
                          onChange={(e) =>
                            updateUserGoal(ug.userId, Number(e.target.value) || 0)
                          }
                          aria-label={`Meta de ${ug.userName}`}
                        />
                      </div>

                      {/* Lock icon */}
                      <Lock className="h-4 w-4 shrink-0 text-[var(--foreground)] opacity-70" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Estimativa de esforço */}
            {estimate && (
              <div>
                <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">
                  Estimativa de esforço para atingir a meta
                </h3>
                <div className="rounded-lg border bg-[var(--card)] p-4 text-sm text-[var(--foreground)]">
                  Será necessário finalizar <strong>{estimate.leadsNeeded} leads</strong> e
                  realizar uma média de <strong>{estimate.activitiesPerDay} atividades</strong> diárias por vendedor.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button onClick={handleSave} disabled={isPending || loading}>
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              'Salvar metas'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
