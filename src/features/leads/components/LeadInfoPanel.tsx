'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  CalendarDays,
  Clock,
  FileText,
  Pencil,
  Plus,
  Save,
  Trash2,
  User,
  X,
} from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
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

import type { TimelineEntry } from '@/features/cadences/cadences.contract';
import type { CustomFieldRow } from '@/features/settings-prospecting/types/custom-field';

import type { LeadSourceOption } from '../actions/get-lead-source-options';
import { LEAD_SOURCE_OPTIONS } from '../schemas/lead.schemas';
import type { LeadPhone } from '../types';
import { updateLead } from '../actions/update-lead';

import { LeadNotes } from './LeadNotes';
import { MeetimeFieldRow } from './MeetimeFieldRow';
import type { LeadInfoPanelData } from './lead-info-panel.utils';
import { LeadInfoPanelHeader } from './LeadInfoPanelHeader';
import { LeadTimelineTab } from './LeadTimelineTab';
import { LeadScheduleTab } from './LeadScheduleTab';

export interface LeadInfoPanelProps {
  data: LeadInfoPanelData;
  enrollment?: { cadence_name: string; enrolled_by_email: string | null } | null;
  enrollments?: Array<{ cadence_name: string; enrolled_by_email: string | null }>;
  timeline?: TimelineEntry[];
  showLeadHeader?: boolean;
  cadenceConfig?: { cadenceName: string; stepOrder: number; totalSteps: number };
  kpis?: { completed: number; open: number; conversations: number };
  customFieldDefs?: CustomFieldRow[];
  leadSourceOptions?: LeadSourceOption[];
}

type TabId = 'dados' | 'timeline' | 'notas' | 'agendar';

export function LeadInfoPanel({
  data: initialData,
  enrollment: _enrollment,
  enrollments: _enrollments,
  timeline,
  showLeadHeader = false,
  cadenceConfig: _cadenceConfig,
  kpis,
  customFieldDefs,
  leadSourceOptions,
}: LeadInfoPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const sourceOptions = leadSourceOptions ?? LEAD_SOURCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

  // Local state for lead data — survives router.refresh() in activity execution context
  const [data, setData] = useState(initialData);
  const [trackedLeadId, setTrackedLeadId] = useState(initialData.id);

  // Re-initialize when showing a different lead
  if (initialData.id !== trackedLeadId) {
    setData(initialData);
    setTrackedLeadId(initialData.id);
  }

  const availableTabs: { id: TabId; icon: typeof User; label: string }[] = [
    { id: 'dados', icon: User, label: 'Dados' },
    { id: 'timeline', icon: Clock, label: 'Timeline' },
    { id: 'notas', icon: FileText, label: 'Notas' },
    { id: 'agendar', icon: CalendarDays, label: 'Agendar' },
  ];

  const [activeTab, setActiveTab] = useState<TabId>('dados');
  const [isEditing, setIsEditing] = useState(false);

  // Primary contact (first socio)
  const primarySocio = data.socios?.[0] ?? null;

  const primaryEmail = (data.socios ?? []).flatMap((s) => s.emails ?? []).sort((a, b) => a.ranking - b.ranking)[0]?.email ?? data.email ?? '';

  const [editFields, setEditFields] = useState({
    first_name: data.first_name ?? primarySocio?.nome?.split(' ')[0] ?? '',
    last_name: data.last_name ?? (primarySocio?.nome?.split(' ').slice(1).join(' ') ?? ''),
    nome_fantasia: data.nome_fantasia ?? '',
    email: primaryEmail,
    job_title: data.job_title ?? primarySocio?.qualificacao ?? '',
    lead_source: data.lead_source ?? '',
    instagram: data.instagram ?? '',
    linkedin: data.linkedin ?? '',
    website: data.website ?? '',
  });

  const [editCustomFieldValues, setEditCustomFieldValues] = useState<Record<string, string>>(
    data.custom_field_values ?? {},
  );

  // Build initial phone entries from phones JSONB (preferred) + telefone fallback
  const buildInitialPhones = useCallback((): LeadPhone[] => {
    const entries: LeadPhone[] = [];
    const seen = new Set<string>();

    // phones JSONB has explicit type — preferred source
    for (const p of data.phones ?? []) {
      const key = p.numero.replace(/\D/g, '');
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({ tipo: p.tipo, numero: p.numero });
      }
    }

    // telefone TEXT fallback (only if not already in phones)
    if (data.telefone) {
      const key = data.telefone.replace(/\D/g, '');
      if (!seen.has(key)) {
        seen.add(key);
        const digits = key.length > 2 ? key.slice(2) : key;
        const isCelular = digits.length >= 9 && digits.startsWith('9');
        entries.push({ tipo: isCelular ? 'celular' : 'fixo', numero: data.telefone });
      }
    }

    if (entries.length === 0) {
      entries.push({ tipo: 'celular', numero: '' });
    }

    return entries;
  }, [data.telefone, data.phones]);

  const [phoneEntries, setPhoneEntries] = useState<LeadPhone[]>(buildInitialPhones);

  const handleAddPhone = useCallback(() => {
    setPhoneEntries((prev) => [...prev, { tipo: 'celular', numero: '' }]);
  }, []);

  const handleRemovePhone = useCallback((index: number) => {
    setPhoneEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handlePhoneChange = useCallback((index: number, field: 'tipo' | 'numero', value: string) => {
    setPhoneEntries((prev) =>
      prev.map((entry, i) =>
        i === index ? { ...entry, [field]: value } : entry,
      ),
    );
  }, []);

  const handleSave = useCallback(() => {
    startTransition(async () => {
      const { email: editEmail, ...leadFields } = editFields;

      // Filter out empty phone entries
      const validPhones = phoneEntries.filter((p) => p.numero.trim() !== '');
      const primaryPhone = validPhones[0]?.numero ?? '';

      const result = await updateLead(data.id, {
        ...leadFields,
        email: editEmail,
        telefone: primaryPhone,
        phones: validPhones,
        custom_field_values: editCustomFieldValues,
      });
      if (result.success) {
        setData((prev) => ({
          ...prev,
          first_name: editFields.first_name || null,
          last_name: editFields.last_name || null,
          nome_fantasia: editFields.nome_fantasia || null,
          email: editEmail || null,
          telefone: primaryPhone || null,
          phones: validPhones,
          job_title: editFields.job_title || null,
          lead_source: editFields.lead_source || null,
          instagram: editFields.instagram || null,
          linkedin: editFields.linkedin || null,
          website: editFields.website || null,
          custom_field_values: editCustomFieldValues,
        }));
        toast.success('Lead atualizado');
        setIsEditing(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [data.id, editFields, editCustomFieldValues, phoneEntries, router]);

  const handleCancelEdit = useCallback(() => {
    setEditFields({
      first_name: data.first_name ?? primarySocio?.nome?.split(' ')[0] ?? '',
      last_name: data.last_name ?? (primarySocio?.nome?.split(' ').slice(1).join(' ') ?? ''),
      nome_fantasia: data.nome_fantasia ?? '',
      email: primaryEmail,
      job_title: data.job_title ?? primarySocio?.qualificacao ?? '',
      lead_source: data.lead_source ?? '',
      instagram: data.instagram ?? '',
      linkedin: data.linkedin ?? '',
      website: data.website ?? '',
    });
    setPhoneEntries(buildInitialPhones());
    setEditCustomFieldValues(data.custom_field_values ?? {});
    setIsEditing(false);
  }, [data, primarySocio, primaryEmail, buildInitialPhones]);

  const contactFullName = data.first_name ? `${data.first_name} ${data.last_name ?? ''}`.trim() : null;
  const fullName = contactFullName ?? primarySocio?.nome ?? data.razao_social ?? null;
  const firstName = data.first_name ?? fullName?.split(' ')[0] ?? null;
  const companyName = data.nome_fantasia ?? data.razao_social ?? null;
  const cargo = data.job_title
    || primarySocio?.qualificacao
    || (primarySocio?.nome ? (primarySocio.nome.trim().split(/\s+/)[0]?.toLowerCase().endsWith('a') ? 'Sócia' : 'Sócio') : null);

  // Gather all phones with type, deduplicating by normalized number
  const seenPhones = new Set<string>();
  const allPhones: Array<{ tipo: string; numero: string; href: string; whatsapp: boolean; nome?: string }> = [];

  // Helper: normalize phone to digits only for dedup
  const normalizePhone = (phone: string) => phone.replace(/\D/g, '');

  // Socios celulares first (more specific: has whatsapp flag, nome)
  for (const socio of data.socios ?? []) {
    for (const cel of socio.celulares ?? []) {
      const formatted = `(${cel.ddd}) ${cel.numero}`;
      const key = normalizePhone(formatted);
      if (!seenPhones.has(key)) {
        seenPhones.add(key);
        allPhones.push({
          tipo: 'Celular',
          numero: formatted,
          href: `tel:+55${cel.ddd}${cel.numero}`,
          whatsapp: cel.whatsapp,
          nome: socio.nome,
        });
      }
    }
  }

  // Phones from phones JSONB (has explicit type — preferred source)
  for (const phone of data.phones ?? []) {
    const key = normalizePhone(phone.numero);
    if (!seenPhones.has(key)) {
      seenPhones.add(key);
      allPhones.push({
        tipo: phone.tipo === 'celular' ? 'Celular' : phone.tipo === 'whatsapp' ? 'WhatsApp' : 'Fixo',
        numero: phone.numero,
        href: `tel:${phone.numero}`,
        whatsapp: phone.tipo === 'whatsapp',
      });
    }
  }

  // Company-level phone fallback (only if not already in phones JSONB)
  if (data.telefone) {
    const key = normalizePhone(data.telefone);
    if (!seenPhones.has(key)) {
      const digits = key.length > 2 ? key.slice(2) : key;
      const isCelular = digits.length >= 9 && digits.startsWith('9');
      allPhones.push({
        tipo: isCelular ? 'Celular' : 'Fixo',
        numero: data.telefone,
        href: `tel:${data.telefone}`,
        whatsapp: false,
      });
      seenPhones.add(key);
    }
  }

  const avatarInitial = (firstName ?? companyName ?? data.cnpj ?? '?')[0]?.toUpperCase() ?? '?';
  const headerName = fullName ?? companyName ?? data.cnpj ?? '—';
  const headerCompany = fullName && companyName && fullName !== companyName ? companyName : null;

  return (
    <div className={`flex h-full shrink-0 flex-col ${showLeadHeader ? 'w-full' : 'w-80'}`}>
      {/* Lead header — avatar + name + actions shown only in activity execution */}
      {showLeadHeader && (
        <LeadInfoPanelHeader
          leadId={data.id}
          avatarInitial={avatarInitial}
          headerName={headerName}
          headerCompany={headerCompany}
          fitScore={data.fit_score}
          engagementScore={data.engagement_score}
          timeline={timeline}
          onNavigateToTimeline={() => setActiveTab('timeline')}
        />
      )}

      {/* KPIs */}
      {kpis && (
        <div className="mb-4 rounded-lg border bg-[var(--card)] p-3">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold">{kpis.completed}</p>
              <p className="text-[10px] font-medium uppercase text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Completado
              </p>
            </div>
            <div>
              <p className="text-2xl font-bold">{kpis.open}</p>
              <p className="text-[10px] font-medium uppercase text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Aberto{kpis.open !== 1 ? 's' : ''}
              </p>
            </div>
            <div>
              <p className="text-2xl font-bold">{kpis.conversations}</p>
              <p className="text-[10px] font-medium uppercase text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Conversa{kpis.conversations !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <TooltipProvider>
        <div className="mb-3 flex border-b border-[var(--border)]">
          {availableTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex flex-1 items-center justify-center border-b-2 py-2 transition-colors ${
                      activeTab === tab.id
                        ? 'border-[var(--primary)] text-[var(--primary)]'
                        : 'border-transparent text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{tab.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto pr-1">
        {/* Tab Dados */}
        {activeTab === 'dados' && (
          <div className="space-y-4">

            {/* GERAL — contact principal */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Geral
              </h4>
              {isEditing ? (
                <>
                  <div className="space-y-1">
                    <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Primeiro nome</p>
                    <Input
                      value={editFields.first_name}
                      onChange={(e) => setEditFields({ ...editFields, first_name: e.target.value })}
                      className="h-8 text-sm"
                      placeholder="Primeiro nome"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Sobrenome</p>
                    <Input
                      value={editFields.last_name}
                      onChange={(e) => setEditFields({ ...editFields, last_name: e.target.value })}
                      className="h-8 text-sm"
                      placeholder="Sobrenome"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">E-mail</p>
                    <Input
                      value={editFields.email}
                      onChange={(e) => setEditFields({ ...editFields, email: e.target.value })}
                      className="h-8 text-sm"
                      placeholder="email@empresa.com"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Empresa</p>
                    <Input
                      value={editFields.nome_fantasia}
                      onChange={(e) => setEditFields({ ...editFields, nome_fantasia: e.target.value })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Cargo</p>
                    <Input
                      value={editFields.job_title}
                      onChange={(e) => setEditFields({ ...editFields, job_title: e.target.value })}
                      className="h-8 text-sm"
                      placeholder="Cargo"
                    />
                  </div>
                </>
              ) : (
                <>
                  {firstName && <MeetimeFieldRow label="Primeiro nome" value={firstName} />}
                  {data.last_name ? (
                    <MeetimeFieldRow label="Sobrenome" value={data.last_name} />
                  ) : fullName && fullName !== firstName ? (
                    <MeetimeFieldRow label="Nome completo" value={fullName} />
                  ) : null}
                  {primaryEmail && <MeetimeFieldRow label="E-mail" value={primaryEmail} href={`mailto:${primaryEmail}`} />}
                  {companyName && <MeetimeFieldRow label="Empresa" value={companyName} />}
                  <MeetimeFieldRow label="Cargo" value={cargo || '—'} />
                </>
              )}
            </div>

            <hr className="border-t-2 border-[var(--border)]" />

            {/* TELEFONE(S) — with type descriptor */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Telefone(s)
              </h4>
              {isEditing ? (
                <div className="space-y-2">
                  {phoneEntries.map((entry, index) => (
                    <div key={`phone-edit-${index}`} className="flex items-end gap-1.5">
                      <div className="w-[100px] shrink-0 space-y-1">
                        {index === 0 && <p className="text-[10px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Tipo</p>}
                        <Select
                          value={entry.tipo}
                          onValueChange={(val) => handlePhoneChange(index, 'tipo', val)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="celular">Celular</SelectItem>
                            <SelectItem value="fixo">Fixo</SelectItem>
                            <SelectItem value="whatsapp">WhatsApp</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        {index === 0 && <p className="text-[10px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Número</p>}
                        <Input
                          value={entry.numero}
                          onChange={(e) => handlePhoneChange(index, 'numero', e.target.value)}
                          className="h-8 text-sm"
                          placeholder="(11) 99000-0000"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-red-500"
                        onClick={() => handleRemovePhone(index)}
                        disabled={phoneEntries.length <= 1}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-7 text-xs text-[var(--primary)]"
                    onClick={handleAddPhone}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Adicionar telefone
                  </Button>
                </div>
              ) : allPhones.length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Nenhum telefone informado.</p>
              ) : (
                allPhones.map((phone, i) => (
                  <div key={`phone-${i}`} className="flex gap-2">
                    <div className="w-20 shrink-0 space-y-1">
                      <p className="text-[10px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Descrição:</p>
                      <div className="rounded-md bg-[var(--muted)] px-2 py-1.5 text-sm font-medium">
                        {phone.tipo}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-[10px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Telefone:</p>
                      <div className="rounded-md bg-[var(--muted)] px-3 py-1.5 text-sm">
                        <a href={phone.href} className="text-[var(--primary)] hover:underline truncate">
                          {phone.numero}
                        </a>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <hr className="border-t-2 border-[var(--border)]" />

            {/* SOCIAL */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Social
              </h4>
              {isEditing ? (
                <>
                  <div className="space-y-1">
                    <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Instagram</p>
                    <Input
                      value={editFields.instagram}
                      onChange={(e) => setEditFields({ ...editFields, instagram: e.target.value })}
                      className="h-8 text-sm"
                      placeholder="@usuario"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">LinkedIn</p>
                    <Input
                      value={editFields.linkedin}
                      onChange={(e) => setEditFields({ ...editFields, linkedin: e.target.value })}
                      className="h-8 text-sm"
                      placeholder="https://linkedin.com/in/..."
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Site</p>
                    <Input
                      value={editFields.website}
                      onChange={(e) => setEditFields({ ...editFields, website: e.target.value })}
                      className="h-8 text-sm"
                      placeholder="https://..."
                    />
                  </div>
                </>
              ) : (
                <>
                  <MeetimeFieldRow label="Instagram" value={data.instagram || '—'} href={data.instagram ? `https://instagram.com/${data.instagram.replace('@', '')}` : undefined} />
                  <MeetimeFieldRow label="LinkedIn" value={data.linkedin || '—'} href={data.linkedin || undefined} />
                  <MeetimeFieldRow label="Site" value={data.website || '—'} href={data.website || undefined} />
                </>
              )}
            </div>

            <hr className="border-t-2 border-[var(--border)]" />

            {/* STATUS — metadados internos */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Status
              </h4>
              {isEditing ? (
                <div className="space-y-1">
                  <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Origem</p>
                  <Select
                    value={editFields.lead_source ?? 'none'}
                    onValueChange={(value) => {
                      setEditFields((prev) => ({ ...prev, lead_source: value === 'none' ? '' : value }));
                    }}
                  >
                    <SelectTrigger className="w-full text-sm">
                      <SelectValue placeholder="Selecione a origem" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {sourceOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <MeetimeFieldRow
                  label="Origem"
                  value={sourceOptions.find((o) => o.value === data.lead_source)?.label ?? data.lead_source ?? '—'}
                />
              )}
            </div>

            {/* CUSTOM FIELDS */}
            {customFieldDefs && customFieldDefs.length > 0 && (
              <>
                <hr className="border-t-2 border-[var(--border)]" />
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                    Campos personalizados
                  </h4>
                  {isEditing ? (
                    customFieldDefs.map((cf) => (
                      <div key={cf.id} className="space-y-1">
                        <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{cf.field_name}</p>
                        {cf.field_type === 'select' && cf.options && cf.options.length > 0 ? (
                          <Select
                            value={editCustomFieldValues[cf.id] ?? 'none'}
                            onValueChange={(v) =>
                              setEditCustomFieldValues((prev) => ({ ...prev, [cf.id]: v === 'none' ? '' : v }))
                            }
                          >
                            <SelectTrigger className="w-full text-sm">
                              <SelectValue placeholder="Selecione..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">—</SelectItem>
                              {cf.options.map((opt) => (
                                <SelectItem key={opt} value={opt}>
                                  {opt}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            value={editCustomFieldValues[cf.id] ?? ''}
                            onChange={(e) =>
                              setEditCustomFieldValues((prev) => ({ ...prev, [cf.id]: e.target.value }))
                            }
                            className="h-8 text-sm"
                            type={cf.field_type === 'number' ? 'number' : cf.field_type === 'date' ? 'date' : 'text'}
                            placeholder={cf.field_name}
                          />
                        )}
                      </div>
                    ))
                  ) : (
                    customFieldDefs.map((cf) => (
                      <MeetimeFieldRow
                        key={cf.id}
                        label={cf.field_name}
                        value={data.custom_field_values?.[cf.id] || '—'}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab Timeline */}
        {activeTab === 'timeline' && <LeadTimelineTab timeline={timeline} />}

        {/* Tab Notas */}
        {activeTab === 'notas' && (
          <LeadNotes leadId={data.id} notes={null} />
        )}

        {/* Tab Agendar */}
        {activeTab === 'agendar' && (
          <LeadScheduleTab
            leadId={data.id}
            leadEmail={data.email}
            companyName={data.nome_fantasia ?? data.razao_social}
          />
        )}
      </div>

      {/* FAB — sticky, only on Dados tab */}
      {activeTab === 'dados' && (
        <div className="sticky bottom-0 flex justify-end gap-2 pt-3 pb-1 pointer-events-none [&>*]:pointer-events-auto">
          {isEditing ? (
            <>
              <Button
                size="icon"
                variant="outline"
                className="h-10 w-10 rounded-full shadow-lg"
                onClick={handleCancelEdit}
                disabled={isPending}
              >
                <X className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="default"
                className="h-10 w-10 rounded-full shadow-lg"
                onClick={handleSave}
                disabled={isPending}
              >
                <Save className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Button
              size="icon"
              variant="default"
              className="h-10 w-10 rounded-full shadow-lg"
              onClick={() => setIsEditing(true)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
