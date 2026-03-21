'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Briefcase, CalendarClock, Loader2, Radio, Search, UserRound } from 'lucide-react';
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
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Separator } from '@/shared/components/ui/separator';

import { LEAD_SOURCE_OPTIONS } from '../schemas/lead.schemas';
import { createLead } from '../actions/create-lead';
import { fetchActiveCadences } from '../actions/fetch-active-cadences';
import { fetchOrgMembersAuth, type OrgMemberOption } from '../actions/fetch-org-members';

interface ActiveCadence {
  id: string;
  name: string;
  total_steps: number;
}

interface CreateLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string;
}

const INITIAL_FORM = {
  first_name: '',
  last_name: '',
  email: '',
  telefone: '',
  empresa: '',
  job_title: '',
  lead_source: '',
  is_inbound: false,
  assigned_to: '',
  cadence_id: '',
  enrollment_mode: 'immediate' as 'immediate' | 'scheduled',
  scheduled_start: '',
};

export function CreateLeadDialog({ open, onOpenChange, currentUserId }: CreateLeadDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({ ...INITIAL_FORM, assigned_to: currentUserId });

  // Data loading states
  const [members, setMembers] = useState<OrgMemberOption[]>([]);
  const [cadences, setCadences] = useState<ActiveCadence[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cadenceSearch, setCadenceSearch] = useState('');

  const isLoading = open && !loaded;

  // Load members and cadences when dialog opens
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;

    Promise.all([fetchOrgMembersAuth(), fetchActiveCadences()]).then(
      ([membersResult, cadencesResult]) => {
        if (cancelled) return;
        if (membersResult.success) setMembers(membersResult.data);
        if (cadencesResult.success) setCadences(cadencesResult.data);
        setLoaded(true);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  const filteredCadences = useMemo(() => {
    if (!cadenceSearch) return cadences;
    const q = cadenceSearch.toLowerCase();
    return cadences.filter((c) => c.name.toLowerCase().includes(q));
  }, [cadences, cadenceSearch]);

  const resetForm = useCallback(() => {
    setForm({ ...INITIAL_FORM, assigned_to: currentUserId });
    setCadenceSearch('');
  }, [currentUserId]);

  function handleOpenChange(value: boolean) {
    if (!value) resetForm();
    onOpenChange(value);
  }

  const hasCadence = form.cadence_id !== '';
  const isScheduled = form.enrollment_mode === 'scheduled';

  const isFormValid =
    form.first_name.trim() !== '' &&
    form.last_name.trim() !== '' &&
    form.email.trim() !== '' &&
    form.telefone.trim() !== '' &&
    form.empresa.trim() !== '' &&
    form.job_title.trim() !== '' &&
    form.lead_source !== '' &&
    form.assigned_to !== '' &&
    (!isScheduled || !hasCadence || form.scheduled_start !== '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload: Record<string, unknown> = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        telefone: form.telefone,
        empresa: form.empresa,
        job_title: form.job_title,
        lead_source: form.lead_source,
        is_inbound: form.is_inbound,
        assigned_to: form.assigned_to,
        cadence_id: form.cadence_id || undefined,
        enrollment_mode: form.enrollment_mode,
      };

      if (form.enrollment_mode === 'scheduled' && form.scheduled_start) {
        payload.scheduled_start = new Date(form.scheduled_start).toISOString();
      }

      const result = await createLead(payload);

      if (result.success) {
        toast.success('Lead criado com sucesso');
        handleOpenChange(false);
        router.push(`/leads/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar Lead</DialogTitle>
          <DialogDescription>
            Cadastre o lead e configure a entrada na cadência.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* SECTION 1: CONFIGURACOES DE ENTRADA */}
            <div>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Configurações de Entrada
              </h3>
              <div className="space-y-4">
                {/* Inbound flag */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={form.is_inbound}
                    onCheckedChange={(v) => setForm({ ...form, is_inbound: v === true })}
                  />
                  <span className="text-sm font-medium">Lead inbound</span>
                </label>

                {/* Modo de inicio */}
                <div className="space-y-3">
                  <RadioGroup
                    value={form.enrollment_mode}
                    onValueChange={(v) =>
                      setForm({ ...form, enrollment_mode: v as 'immediate' | 'scheduled' })
                    }
                    className={!hasCadence ? 'opacity-50 pointer-events-none' : ''}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
                      <label
                        htmlFor="mode-immediate"
                        className="flex cursor-pointer items-start gap-3"
                      >
                        <RadioGroupItem value="immediate" id="mode-immediate" className="mt-0.5" />
                        <div>
                          <span className="text-sm font-medium">Início imediato</span>
                          <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                            Disponibilizar a execução do lead imediatamente.
                          </p>
                        </div>
                      </label>
                      <label
                        htmlFor="mode-scheduled"
                        className="flex cursor-pointer items-start gap-3"
                      >
                        <RadioGroupItem value="scheduled" id="mode-scheduled" className="mt-0.5" />
                        <div>
                          <span className="text-sm font-medium">Agendar início</span>
                          <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                            O lead entrará na cadência na data e hora escolhidas.
                          </p>
                        </div>
                      </label>
                    </div>
                  </RadioGroup>

                  {/* Date/time picker for scheduled start */}
                  {hasCadence && isScheduled && (
                    <div className="ml-7 space-y-2">
                      <Label className="flex items-center gap-1.5">
                        <CalendarClock className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                        Data e hora de início
                      </Label>
                      <Input
                        type="datetime-local"
                        value={form.scheduled_start}
                        onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })}
                        min={new Date().toISOString().slice(0, 16)}
                      />
                    </div>
                  )}
                </div>

                {/* Responsavel + Cadencia */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      <UserRound className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                      Responsável <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={form.assigned_to}
                      onValueChange={(v) => setForm({ ...form, assigned_to: v })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione o responsável" />
                      </SelectTrigger>
                      <SelectContent>
                        {members.map((m) => (
                          <SelectItem key={m.userId} value={m.userId}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      <Radio className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                      Cadência
                    </Label>
                    <Select
                      value={form.cadence_id || 'none'}
                      onValueChange={(v) => {
                        setForm({ ...form, cadence_id: v === 'none' ? '' : v });
                        setCadenceSearch('');
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Sem cadência (opcional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <div className="px-2 pb-2">
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                            <input
                              className="w-full rounded-md border border-[var(--border)] bg-transparent py-1.5 pl-7 pr-2 text-sm outline-none placeholder:text-[var(--muted-foreground)] dark:text-[var(--foreground)]"
                              placeholder="Buscar cadência..."
                              value={cadenceSearch}
                              onChange={(e) => setCadenceSearch(e.target.value)}
                              onKeyDown={(e) => e.stopPropagation()}
                            />
                          </div>
                        </div>
                        <SelectItem value="none">Sem cadência</SelectItem>
                        {filteredCadences.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name} ({c.total_steps} {c.total_steps === 1 ? 'passo' : 'passos'})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* SECTION 2: INFORMACOES DO LEAD */}
            <div>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Informações do Lead
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="create-first-name">
                    Primeiro nome <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="create-first-name"
                    value={form.first_name}
                    onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="create-last-name">
                    Sobrenome <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="create-last-name"
                    value={form.last_name}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="create-email">
                    Email <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="create-email"
                    type="email"
                    placeholder="contato@empresa.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="create-telefone">
                    Telefone <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="create-telefone"
                    placeholder="(11) 99999-9999"
                    value={form.telefone}
                    onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="create-empresa">
                    Empresa <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="create-empresa"
                    value={form.empresa}
                    onChange={(e) => setForm({ ...form, empresa: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="create-job-title" className="flex items-center gap-1.5">
                    <Briefcase className="h-3.5 w-3.5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                    Cargo <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="create-job-title"
                    value={form.job_title}
                    onChange={(e) => setForm({ ...form, job_title: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>
                    Origem <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={form.lead_source || 'none'}
                    onValueChange={(v) => setForm({ ...form, lead_source: v === 'none' ? '' : v })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione a fonte" />
                    </SelectTrigger>
                    <SelectContent>
                      {LEAD_SOURCE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending || !isFormValid}>
                {isPending ? 'Criando...' : 'Criar Lead'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
