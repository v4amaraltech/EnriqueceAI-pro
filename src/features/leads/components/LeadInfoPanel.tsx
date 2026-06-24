'use client';

import { useCallback, useContext, useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  CalendarDays,
  ChevronDown,
  Clock,
  FileText,
  Pencil,
  Plus,
  Save,
  Sparkles,
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
import type { StandardFieldSettingRow } from '@/features/settings-prospecting/actions/standard-field-settings';
import { STANDARD_FIELDS } from '@/features/settings-prospecting/constants/standard-fields';
import { OrgContext } from '@/features/auth/components/OrganizationProvider';
import { normalizePhone } from '@/lib/utils/phone';

import { formatDateOnly, formatDateTimeBR } from '@/lib/utils/format';

import type { LeadSourceOption } from '../actions/get-lead-source-options';
import { LEAD_SOURCE_OPTIONS, SEGMENTO_OPTIONS } from '../schemas/lead.schemas';
import { getCanalOptions } from '../utils/canal-options';
import type { LeadPhone, LeadEmail } from '../types';
import { updateLead } from '../actions/update-lead';

import { CurrencyInput, formatBRL } from './CurrencyInput';
import { LeadNotes } from './LeadNotes';
import { InlineEditField } from './InlineEditField';
import { MeetimeFieldRow } from './MeetimeFieldRow';
import type { LeadInfoPanelData } from './lead-info-panel.utils';
import { LeadInfoPanelHeader } from './LeadInfoPanelHeader';
import { LeadTimelineTab } from './LeadTimelineTab';
import { LeadActivityTab } from './LeadActivityTab';
import { LeadScheduleTab } from './LeadScheduleTab';
import { GenerateSpicedDialog } from './GenerateSpicedDialog';

/**
 * Normaliza uma entrada do array `phones`. A coluna JSONB armazena objetos
 * `{ tipo, numero }`, mas alguns leads legados/importados guardaram telefones
 * como strings simples (ex.: `["+55 19 3516-3500"]`). Acessar `.numero` nesses
 * casos retornava `undefined` e quebrava a página de detalhe do lead. Aceita
 * ambos os formatos e sempre devolve um `LeadPhone` válido (ou null se vazio).
 */
function coercePhoneEntry(raw: LeadPhone | string | null | undefined): LeadPhone | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const numero = raw.trim();
    return numero ? { tipo: 'fixo', numero } : null;
  }
  if (!raw.numero) return null;
  return raw;
}

/**
 * Fallback de Cargo: quando o surface que renderiza este painel não passa
 * `jobTitleOptions` (ex.: painel do lead dentro da execução de atividade), o
 * dropdown ficava vazio. Usa os defaults do STANDARD_FIELDS — mesma fonte da
 * tela de Ajustes > Prospecção e do getJobTitleOptions — espelhando o fallback
 * que a Origem (lead_source) já tem.
 */
const DEFAULT_JOB_TITLE_OPTIONS: { value: string; label: string }[] = (
  STANDARD_FIELDS.find((f) => f.key === 'job_title')?.defaultOptions ?? []
).map((label) => ({ value: label, label }));

/**
 * Build a clickable Instagram URL from stored value.
 * Accepts: "https://instagram.com/foo", "instagram.com/foo", "@foo", "foo".
 * Legacy leads stored "@username" — keep them clickable while new ones save full URL.
 */
function normalizeInstagramUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(www\.)?instagram\.com\//i.test(trimmed)) return `https://${trimmed.replace(/^www\./i, '')}`;
  const handle = trimmed.replace(/^@/, '').replace(/\s+/g, '');
  if (!handle) return undefined;
  return `https://instagram.com/${handle}`;
}

/** Prefix bare hostnames with https:// so href stays clickable. */
function normalizeUrlMaybe(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function CollapsibleSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between group"
      >
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          {title}
        </h4>
        <ChevronDown className={`h-3.5 w-3.5 text-[var(--muted-foreground)] transition-transform ${isOpen ? '' : '-rotate-90'}`} />
      </button>
      {isOpen && children}
    </div>
  );
}

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
  jobTitleOptions?: { value: string; label: string }[];
  standardFieldSettings?: StandardFieldSettingRow[];
}

type TabId = 'dados' | 'timeline' | 'notas' | 'agendar' | 'atividade';

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
  jobTitleOptions,
  standardFieldSettings,
}: LeadInfoPanelProps) {
  const [isPending, startTransition] = useTransition();
  const sourceOptions = leadSourceOptions ?? LEAD_SOURCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
  const cargoOptions = jobTitleOptions && jobTitleOptions.length > 0 ? jobTitleOptions : DEFAULT_JOB_TITLE_OPTIONS;

  const orgContext = useContext(OrgContext);
  const members = orgContext?.members ?? [];

  const isFieldVisible = useCallback((key: string) => {
    if (!standardFieldSettings || standardFieldSettings.length === 0) return true;
    const setting = standardFieldSettings.find((s) => s.field_key === key);
    return setting?.is_visible ?? true;
  }, [standardFieldSettings]);

  const assignedMember = initialData.assigned_to
    ? members.find((m) => m.user_id === initialData.assigned_to)
    : null;
  const assignedMemberName = assignedMember?.name
    ?? (initialData.assigned_to ? initialData.assigned_to.slice(0, 8) : null);

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
    { id: 'agendar', icon: CalendarDays, label: 'Reunião' },
    { id: 'atividade', icon: Plus, label: 'Atividade' },
  ];

  const [activeTab, setActiveTab] = useState<TabId>('dados');
  const [isEditing, setIsEditing] = useState(false);
  // Snapshot of the form state captured when editing starts, so on save we
  // send ONLY the fields the user actually changed. Without this the form
  // submits every field (pre-filled from socio/razao_social fallbacks), and
  // the lead timeline logs all of them as "changed" instead of just the edit.
  const editSnapshotRef = useRef<{
    editFields: Record<string, string>;
    phoneEntries: LeadPhone[];
    emailEntries: LeadEmail[];
    customFieldValues: Record<string, string>;
  } | null>(null);
  const [isSpicedDialogOpen, setIsSpicedDialogOpen] = useState(false);

  // Detect if org has any SPICED-style custom fields configured
  const hasSpicedFields = (customFieldDefs ?? []).some((cf) =>
    /^(S|P|I|CE|E|D)\s*\(/.test(cf.field_name) ||
    cf.field_name === 'Oportunidades' ||
    cf.field_name === 'Gaps da ligação' ||
    cf.field_name === 'Observação Decisor',
  );

  // Primary contact (first socio)
  const primarySocio = data.socios?.[0] ?? null;

  const primaryEmail = (data.socios ?? []).flatMap((s) => s.emails ?? []).sort((a, b) => a.ranking - b.ranking)[0]?.email ?? data.email ?? '';

  const [editFields, setEditFields] = useState({
    first_name: data.first_name ?? primarySocio?.nome?.split(' ')[0] ?? '',
    last_name: data.last_name ?? (primarySocio?.nome?.split(' ').slice(1).join(' ') ?? ''),
    nome_fantasia: data.nome_fantasia ?? data.razao_social ?? '',
    email: primaryEmail,
    job_title: data.job_title ?? primarySocio?.qualificacao ?? '',
    lead_source: data.lead_source ?? '',
    canal: data.canal ?? '',
    segmento: data.segmento ?? '',
    cnpj: data.cnpj ?? '',
    instagram: data.instagram ?? '',
    linkedin: data.linkedin ?? '',
    website: data.website ?? '',
  });

  const [editCustomFieldValues, setEditCustomFieldValues] = useState<Record<string, string>>(
    data.custom_field_values ?? {},
  );

  // Reset all edit state when lead changes
  useEffect(() => {
    setIsEditing(false);
    setActiveTab('dados');
    const socio = data.socios?.[0] ?? null;
    const email = (data.socios ?? []).flatMap((s) => s.emails ?? []).sort((a, b) => a.ranking - b.ranking)[0]?.email ?? data.email ?? '';
    setEditFields({
      first_name: data.first_name ?? socio?.nome?.split(' ')[0] ?? '',
      last_name: data.last_name ?? (socio?.nome?.split(' ').slice(1).join(' ') ?? ''),
      nome_fantasia: data.nome_fantasia ?? data.razao_social ?? '',
      email,
      job_title: data.job_title ?? socio?.qualificacao ?? '',
      lead_source: data.lead_source ?? '',
      canal: data.canal ?? '',
      segmento: data.segmento ?? '',
      cnpj: data.cnpj ?? '',
      instagram: data.instagram ?? '',
      linkedin: data.linkedin ?? '',
      website: data.website ?? '',
    });
    setEditCustomFieldValues(data.custom_field_values ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedLeadId]);

  // Build initial phone entries — mirrors the view-mode `allPhones` sources so
  // clicking the pencil never makes a visible phone disappear.
  const buildInitialPhones = useCallback((): LeadPhone[] => {
    const entries: LeadPhone[] = [];
    const seen = new Set<string>();

    // Socios celulares (auto-enriched from CNPJ, may have whatsapp flag)
    for (const socio of data.socios ?? []) {
      for (const cel of socio.celulares ?? []) {
        const formatted = `(${cel.ddd}) ${cel.numero}`;
        const key = normalizePhone(formatted);
        if (!seen.has(key)) {
          seen.add(key);
          entries.push({ tipo: cel.whatsapp ? 'whatsapp' : 'celular', numero: formatted });
        }
      }
    }

    // Phones JSONB (user-edited list, has explicit type)
    for (const raw of data.phones ?? []) {
      const phone = coercePhoneEntry(raw);
      if (!phone) continue;
      const key = normalizePhone(phone.numero);
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({ tipo: phone.tipo, numero: phone.numero });
      }
    }

    // Legacy company-level telefone fallback
    if (data.telefone) {
      const key = normalizePhone(data.telefone);
      if (!seen.has(key)) {
        seen.add(key);
        let local = key;
        if (local.length >= 12 && local.startsWith('55')) local = local.slice(2);
        if (local.length >= 10) local = local.slice(2);
        const isCelular = local.length >= 9 && local.startsWith('9');
        const isWhatsAppSource = data.lead_source === 'Leadbroker' || data.lead_source === 'Blackbox';
        const tipo: LeadPhone['tipo'] = isWhatsAppSource ? 'whatsapp' : (isCelular ? 'celular' : 'fixo');
        entries.push({ tipo, numero: data.telefone });
      }
    }

    if (entries.length === 0) {
      entries.push({ tipo: 'celular', numero: '' });
    }

    return entries;
  }, [data.telefone, data.phones, data.socios, data.lead_source]);

  const [phoneEntries, setPhoneEntries] = useState<LeadPhone[]>(buildInitialPhones);

  // Reset phone entries when lead changes (buildInitialPhones depends on data which updates on next render)
  useEffect(() => {
    setPhoneEntries(buildInitialPhones());
  }, [trackedLeadId, buildInitialPhones]);

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

  // Build initial email entries from emails JSONB or socios + email fallback
  const buildInitialEmails = useCallback((): LeadEmail[] => {
    if (Array.isArray(data.emails)) {
      if (data.emails.length > 0) {
        return data.emails.map((e) => ({ tipo: e.tipo, email: e.email }));
      }
      return [{ tipo: 'corporativo', email: '' }];
    }

    // Bootstrap: merge socios emails + lead.email
    const entries: LeadEmail[] = [];
    const seen = new Set<string>();

    for (const socio of data.socios ?? []) {
      for (const se of socio.emails ?? []) {
        const key = se.email.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          entries.push({ tipo: 'corporativo', email: se.email });
        }
      }
    }

    if (data.email) {
      const key = data.email.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({ tipo: 'corporativo', email: data.email });
      }
    }

    if (entries.length === 0) {
      entries.push({ tipo: 'corporativo', email: '' });
    }

    return entries;
  }, [data.email, data.emails, data.socios]);

  const [emailEntries, setEmailEntries] = useState<LeadEmail[]>(buildInitialEmails);

  useEffect(() => {
    setEmailEntries(buildInitialEmails());
  }, [trackedLeadId, buildInitialEmails]);

  const handleAddEmail = useCallback(() => {
    setEmailEntries((prev) => [...prev, { tipo: 'corporativo', email: '' }]);
  }, []);

  const handleRemoveEmail = useCallback((index: number) => {
    setEmailEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleEmailEntryChange = useCallback((index: number, field: 'tipo' | 'email', value: string) => {
    setEmailEntries((prev) =>
      prev.map((entry, i) =>
        i === index ? { ...entry, [field]: value } : entry,
      ),
    );
  }, []);

  const handleStartEdit = useCallback(() => {
    // Capture the baseline the form shows now, so save can diff against it.
    editSnapshotRef.current = {
      editFields: { ...editFields },
      phoneEntries: phoneEntries.map((p) => ({ ...p })),
      emailEntries: emailEntries.map((e) => ({ ...e })),
      customFieldValues: { ...editCustomFieldValues },
    };
    setIsEditing(true);
  }, [editFields, phoneEntries, emailEntries, editCustomFieldValues]);

  const handleSave = useCallback(() => {
    startTransition(async () => {
      const { email: _editEmail, ...leadFields } = editFields;

      // Filter out empty phone/email entries
      const validPhones = phoneEntries.filter((p) => (p.numero ?? '').trim() !== '');
      const primaryPhone = validPhones[0]?.numero ?? '';
      const validEmails = emailEntries.filter((e) => (e.email ?? '').trim() !== '');
      const primaryEmailValue = validEmails[0]?.email ?? '';

      // Remove empty cnpj/canal/segmento to avoid check constraint violations
      const cleanFields: Record<string, unknown> = { ...leadFields };
      if (!(cleanFields.cnpj as string)?.trim()) delete cleanFields.cnpj;
      if (!(cleanFields.canal as string)?.trim()) delete cleanFields.canal;
      if (!(cleanFields.segmento as string)?.trim()) delete cleanFields.segmento;

      // Send ONLY the fields the user actually changed, diffing against the
      // snapshot taken when editing started. Avoids submitting pre-filled
      // fallback values (socio name, razao_social) that were never touched,
      // which would otherwise show up as bogus entries in the lead timeline.
      const snap = editSnapshotRef.current;
      const same = (a: unknown, b: unknown) =>
        (typeof a === 'string' ? a.trim() : a ?? '') === (typeof b === 'string' ? b.trim() : b ?? '');

      const updatePayload: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(cleanFields)) {
        if (!snap || !same(val, snap.editFields[key])) updatePayload[key] = val;
      }

      // Phones/emails/custom are arrays/objects — compare structurally.
      const phonesChanged = !snap || JSON.stringify(validPhones) !== JSON.stringify(snap.phoneEntries.filter((p) => (p.numero ?? '').trim() !== ''));
      if (phonesChanged) {
        updatePayload.telefone = primaryPhone;
        updatePayload.phones = validPhones;
      }
      const emailsChanged = !snap || JSON.stringify(validEmails) !== JSON.stringify(snap.emailEntries.filter((e) => (e.email ?? '').trim() !== ''));
      if (emailsChanged) {
        updatePayload.email = primaryEmailValue;
        // Only send emails if column exists (migration applied)
        if (Array.isArray(data.emails) || validEmails.length > 0) {
          updatePayload.emails = validEmails;
        }
      }
      const customChanged = !snap || JSON.stringify(editCustomFieldValues) !== JSON.stringify(snap.customFieldValues);
      if (customChanged) {
        updatePayload.custom_field_values = editCustomFieldValues;
      }

      // Nothing actually changed — close edit mode without a no-op write.
      if (Object.keys(updatePayload).length === 0) {
        setIsEditing(false);
        return;
      }

      const result = await updateLead(data.id, updatePayload);
      if (result.success) {
        setData((prev) => ({
          ...prev,
          first_name: editFields.first_name || null,
          last_name: editFields.last_name || null,
          nome_fantasia: editFields.nome_fantasia || null,
          email: primaryEmailValue || null,
          emails: validEmails,
          telefone: primaryPhone || null,
          phones: validPhones,
          job_title: editFields.job_title || null,
          lead_source: editFields.lead_source || null,
          canal: editFields.canal || null,
          segmento: editFields.segmento || null,
          cnpj: editFields.cnpj || null,
          instagram: editFields.instagram || null,
          linkedin: editFields.linkedin || null,
          website: editFields.website || null,
          custom_field_values: editCustomFieldValues,
        }));
        toast.success('Lead atualizado');
        setIsEditing(false);
      } else {
        toast.error(result.error);
      }
    });
  }, [data.id, data.emails, editFields, editCustomFieldValues, phoneEntries, emailEntries]);

  const handleCancelEdit = useCallback(() => {
    setEditFields({
      first_name: data.first_name ?? primarySocio?.nome?.split(' ')[0] ?? '',
      last_name: data.last_name ?? (primarySocio?.nome?.split(' ').slice(1).join(' ') ?? ''),
      nome_fantasia: data.nome_fantasia ?? '',
      email: primaryEmail,
      job_title: data.job_title ?? primarySocio?.qualificacao ?? '',
      lead_source: data.lead_source ?? '',
      canal: data.canal ?? '',
      segmento: data.segmento ?? '',
      cnpj: data.cnpj ?? '',
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
  const _cargo = data.job_title
    || primarySocio?.qualificacao
    || (primarySocio?.nome ? (primarySocio.nome.trim().split(/\s+/)[0]?.toLowerCase().endsWith('a') ? 'Sócia' : 'Sócio') : null);

  // Gather all phones with type, deduplicating by normalized number
  const seenPhones = new Set<string>();
  const allPhones: Array<{ tipo: string; numero: string; href: string; whatsapp: boolean; nome?: string }> = [];

  // Normalize phone to digits only for dedup

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
  for (const raw of data.phones ?? []) {
    const phone = coercePhoneEntry(raw);
    if (!phone) continue;
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
      let local = key;
      if (local.length >= 12 && local.startsWith('55')) local = local.slice(2);
      if (local.length >= 10) local = local.slice(2);
      const isCelular = local.length >= 9 && local.startsWith('9');
      const isWhatsAppSource = data.lead_source === 'Leadbroker' || data.lead_source === 'Blackbox';
      const isWhatsApp = isWhatsAppSource || false;
      allPhones.push({
        tipo: isWhatsApp ? 'WhatsApp' : (isCelular ? 'Celular' : 'Fixo'),
        numero: data.telefone,
        href: `tel:${data.telefone}`,
        whatsapp: isWhatsApp,
      });
      seenPhones.add(key);
    }
  }

  // Gather all emails for read mode
  const allEmails: Array<{ tipo: string; email: string }> = [];
  if (Array.isArray(data.emails) && data.emails.length > 0) {
    for (const e of data.emails) {
      allEmails.push({ tipo: e.tipo === 'pessoal' ? 'Pessoal' : 'Corporativo', email: e.email });
    }
  } else {
    // Fallback: show primary email
    const pe = primaryEmail;
    if (pe) allEmails.push({ tipo: 'Corporativo', email: pe });
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
            <CollapsibleSection title="Geral">
              {isEditing ? (
                <>
                  {isFieldVisible('first_name') && (
                    <div className="space-y-1">
                      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Primeiro nome</p>
                      <Input
                        value={editFields.first_name}
                        onChange={(e) => setEditFields({ ...editFields, first_name: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="Primeiro nome"
                      />
                    </div>
                  )}
                  {isFieldVisible('last_name') && (
                    <div className="space-y-1">
                      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Sobrenome</p>
                      <Input
                        value={editFields.last_name}
                        onChange={(e) => setEditFields({ ...editFields, last_name: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="Sobrenome"
                      />
                    </div>
                  )}
                  {/* Email is now in the E-MAIL(S) section below */}
                  {isFieldVisible('nome_fantasia') && (
                    <div className="space-y-1">
                      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Empresa</p>
                      <Input
                        value={editFields.nome_fantasia}
                        onChange={(e) => setEditFields({ ...editFields, nome_fantasia: e.target.value })}
                        className="h-8 text-sm"
                      />
                    </div>
                  )}
                  {isFieldVisible('job_title') && (
                    <div className="space-y-1">
                      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Cargo</p>
                      {/* Dropdown da lista gerenciada (Ajustes > Prospecção). Se o lead já
                          tiver um cargo fora da lista, ele é incluído para não ser perdido. */}
                      <Select
                        value={editFields.job_title || 'none'}
                        onValueChange={(value) => {
                          setEditFields((prev) => ({ ...prev, job_title: value === 'none' ? '' : value }));
                        }}
                      >
                        <SelectTrigger className="w-full text-sm">
                          <SelectValue placeholder="Selecione o cargo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {(editFields.job_title && !cargoOptions.some((o) => o.value === editFields.job_title)
                            ? [{ value: editFields.job_title, label: editFields.job_title }, ...cargoOptions]
                            : cargoOptions
                          ).map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {isFieldVisible('lead_source') && (
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
                  )}
                  {isFieldVisible('canal') && (
                    <div className="space-y-1">
                      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Sub-origem</p>
                      <Select
                        value={editFields.canal ?? 'none'}
                        onValueChange={(value) => {
                          setEditFields((prev) => ({ ...prev, canal: value === 'none' ? '' : value }));
                        }}
                      >
                        <SelectTrigger className="w-full text-sm">
                          <SelectValue placeholder="Selecione o canal" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {getCanalOptions(standardFieldSettings).map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {isFieldVisible('segmento') && (
                    <div className="space-y-1">
                      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Segmento</p>
                      <Select
                        value={editFields.segmento ?? 'none'}
                        onValueChange={(value) => {
                          setEditFields((prev) => ({ ...prev, segmento: value === 'none' ? '' : value }));
                        }}
                      >
                        <SelectTrigger className="w-full text-sm">
                          <SelectValue placeholder="Selecione o segmento" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {(standardFieldSettings?.find((s) => s.field_key === 'segmento')?.options ?? SEGMENTO_OPTIONS).map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {isFieldVisible('cnpj') && (
                    <div className="space-y-1">
                      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">CNPJ</p>
                      <Input
                        value={editFields.cnpj ?? ''}
                        onChange={(e) => setEditFields({ ...editFields, cnpj: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="00.000.000/0000-00"
                      />
                    </div>
                  )}
                </>
              ) : (
                <>
                  {isFieldVisible('first_name') && firstName && <MeetimeFieldRow label="Primeiro nome" value={firstName} />}
                  {isFieldVisible('last_name') && (data.last_name ? (
                    <MeetimeFieldRow label="Sobrenome" value={data.last_name} />
                  ) : fullName && fullName !== firstName ? (
                    <MeetimeFieldRow label="Nome completo" value={fullName} />
                  ) : null)}
                  {/* Email is shown in the E-MAIL(S) section below */}
                  {isFieldVisible('nome_fantasia') && (
                    <InlineEditField
                      leadId={data.id}
                      fieldKey="nome_fantasia"
                      label="Empresa"
                      value={data.nome_fantasia ?? data.razao_social}
                      placeholder="Adicionar empresa"
                      onSaved={(v) => {
                        setData((prev) => ({ ...prev, nome_fantasia: v || null }));
                        setEditFields((prev) => ({ ...prev, nome_fantasia: v ?? '' }));
                      }}
                    />
                  )}
                  {/* Cargo is a managed dropdown (Ajustes > Prospecção) — show it
                      read-only here like the other dropdown fields (Origem,
                      Sub-origem, Segmento) so it can only be set by selecting a
                      predefined option in edit mode, never free-typed. */}
                  {isFieldVisible('job_title') && (
                    <MeetimeFieldRow
                      label="Cargo"
                      value={cargoOptions.find((o) => o.value === data.job_title)?.label ?? data.job_title ?? '—'}
                    />
                  )}
                  {isFieldVisible('lead_source') && (
                    <MeetimeFieldRow
                      label="Origem"
                      value={sourceOptions.find((o) => o.value === data.lead_source)?.label ?? data.lead_source ?? '—'}
                    />
                  )}
                  {isFieldVisible('canal') && <MeetimeFieldRow label="Sub-origem" value={data.canal || '—'} />}
                  {isFieldVisible('segmento') && <MeetimeFieldRow label="Segmento" value={data.segmento || '—'} />}
                  {isFieldVisible('cnpj') && <MeetimeFieldRow label="CNPJ" value={data.cnpj || '—'} />}
                  {isFieldVisible('assigned_to') && <MeetimeFieldRow label="SDR Responsável" value={assignedMemberName || '—'} />}
                  {isFieldVisible('created_at') && (
                    <MeetimeFieldRow
                      label="Data de Inscrição"
                      value={data.created_at ? new Date(data.created_at).toLocaleDateString('pt-BR') : '—'}
                    />
                  )}
                </>
              )}
            </CollapsibleSection>

            {isFieldVisible('telefone') && (
            <>
            <hr className="border-t-2 border-[var(--border)]" />

            <CollapsibleSection title="Contatos">
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">E-mail(s)</p>
              {isEditing ? (
                <div className="space-y-2">
                  {emailEntries.map((entry, index) => (
                    <div key={`email-edit-${index}`} className="flex items-end gap-1.5">
                      <div className="w-[100px] shrink-0 space-y-1">
                        {index === 0 && <p className="text-[10px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Tipo</p>}
                        <Select
                          value={entry.tipo}
                          onValueChange={(val) => handleEmailEntryChange(index, 'tipo', val)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="corporativo">Corporativo</SelectItem>
                            <SelectItem value="pessoal">Pessoal</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        {index === 0 && <p className="text-[10px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">E-mail</p>}
                        <Input
                          value={entry.email}
                          onChange={(e) => handleEmailEntryChange(index, 'email', e.target.value)}
                          className="h-8 text-sm"
                          placeholder="email@empresa.com"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remover email"
                        className="h-8 w-8 shrink-0 text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-red-500"
                        onClick={() => handleRemoveEmail(index)}
                        disabled={emailEntries.length <= 1}
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
                    onClick={handleAddEmail}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Adicionar email
                  </Button>
                </div>
              ) : allEmails.length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Nenhum email informado.</p>
              ) : (
                allEmails.map((em, i) => (
                  <div key={`email-${i}`} className="flex gap-2">
                    <div className="w-28 shrink-0 space-y-1">
                      <p className="text-[10px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Descrição:</p>
                      <div className="rounded-md bg-[var(--muted)] px-2 py-1.5 text-sm font-medium">
                        {em.tipo}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-[10px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">E-mail:</p>
                      <div className="rounded-md bg-[var(--muted)] px-3 py-1.5 text-sm">
                        <a href={`mailto:${em.email}`} className="text-[var(--primary)] hover:underline truncate">
                          {em.email}
                        </a>
                      </div>
                    </div>
                  </div>
                ))
              )}
              </div>

              <div className="space-y-2 pt-3 border-t border-[var(--border)]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Telefone(s)</p>
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
                        aria-label="Remover telefone"
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
                    <div className="w-28 shrink-0 space-y-1">
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
            </CollapsibleSection>
            </>
            )}

            {/* SOCIAL */}
            {(isFieldVisible('instagram') || isFieldVisible('linkedin') || isFieldVisible('website')) && (
            <>
            <hr className="border-t-2 border-[var(--border)]" />
            <CollapsibleSection title="Social">
              {isEditing ? (
                <>
                  {isFieldVisible('instagram') && (
                    <div className="space-y-1">
                      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Instagram</p>
                      <Input
                        value={editFields.instagram}
                        onChange={(e) => setEditFields({ ...editFields, instagram: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="https://instagram.com/usuario"
                      />
                    </div>
                  )}
                  {isFieldVisible('linkedin') && (
                    <div className="space-y-1">
                      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">LinkedIn</p>
                      <Input
                        value={editFields.linkedin}
                        onChange={(e) => setEditFields({ ...editFields, linkedin: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="https://linkedin.com/in/..."
                      />
                    </div>
                  )}
                  {isFieldVisible('website') && (
                    <div className="space-y-1">
                      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Site</p>
                      <Input
                        value={editFields.website}
                        onChange={(e) => setEditFields({ ...editFields, website: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="https://..."
                      />
                    </div>
                  )}
                </>
              ) : (
                <>
                  {isFieldVisible('instagram') && <MeetimeFieldRow label="Instagram" value={data.instagram || '—'} href={normalizeInstagramUrl(data.instagram)} />}
                  {isFieldVisible('linkedin') && <MeetimeFieldRow label="LinkedIn" value={data.linkedin || '—'} href={normalizeUrlMaybe(data.linkedin)} />}
                  {isFieldVisible('website') && <MeetimeFieldRow label="Site" value={data.website || '—'} href={normalizeUrlMaybe(data.website)} />}
                </>
              )}
            </CollapsibleSection>
            </>
            )}

            {/* CUSTOM FIELDS */}
            {customFieldDefs && customFieldDefs.length > 0 && (
              <>
                <hr className="border-t-2 border-[var(--border)]" />
                <CollapsibleSection title="Campos personalizados">
                  {hasSpicedFields && !isEditing && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsSpicedDialogOpen(true)}
                      className="w-full justify-center gap-2 border-red-200 bg-red-50/50 text-red-700 hover:bg-red-100 hover:text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Gerar SPICED via IA
                    </Button>
                  )}
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
                        ) : cf.field_type === 'textarea' || cf.field_type === 'text' ? (
                          <textarea
                            value={editCustomFieldValues[cf.id] ?? ''}
                            onChange={(e) =>
                              setEditCustomFieldValues((prev) => ({ ...prev, [cf.id]: e.target.value }))
                            }
                            rows={1}
                            className={`w-full rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] resize-y field-sizing-content ${cf.field_type === 'textarea' ? 'min-h-[80px]' : 'min-h-[40px]'}`}
                            placeholder={cf.field_name}
                          />
                        ) : cf.field_type === 'currency' ? (
                          <CurrencyInput
                            value={editCustomFieldValues[cf.id] ?? ''}
                            onChange={(raw) =>
                              setEditCustomFieldValues((prev) => ({ ...prev, [cf.id]: raw }))
                            }
                            placeholder={cf.field_name}
                            className="h-8 text-sm"
                          />
                        ) : (
                          <Input
                            value={editCustomFieldValues[cf.id] ?? ''}
                            onChange={(e) =>
                              setEditCustomFieldValues((prev) => ({ ...prev, [cf.id]: e.target.value }))
                            }
                            className="h-8 text-sm"
                            type={cf.field_type === 'number' ? 'number' : cf.field_type === 'date' ? 'date' : cf.field_type === 'datetime' ? 'datetime-local' : cf.field_type === 'url' ? 'url' : 'text'}
                            placeholder={cf.field_type === 'url' ? 'https://...' : cf.field_name}
                          />
                        )}
                      </div>
                    ))
                  ) : (
                    customFieldDefs.map((cf) => {
                      const rawVal = data.custom_field_values?.[cf.id];
                      let display: string;
                      if (cf.field_type === 'currency') {
                        display = formatBRL(rawVal);
                      } else if (cf.field_type === 'date') {
                        display = rawVal ? formatDateOnly(rawVal) : '—';
                      } else if (cf.field_type === 'datetime') {
                        display = rawVal ? formatDateTimeBR(rawVal) : '—';
                      } else {
                        display = rawVal || '—';
                      }
                      return (
                        <MeetimeFieldRow
                          key={cf.id}
                          label={cf.field_name}
                          value={display}
                          multiline={cf.field_type === 'textarea' || cf.field_type === 'text'}
                          href={cf.field_type === 'url' && rawVal ? (rawVal.startsWith('http://') || rawVal.startsWith('https://') ? rawVal : `https://${rawVal}`) : undefined}
                        />
                      );
                    })
                  )}
                </CollapsibleSection>
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

        {/* Tab Agendar Reunião */}
        {activeTab === 'agendar' && (
          <LeadScheduleTab
            leadId={data.id}
            leadEmail={data.email}
            companyName={data.nome_fantasia ?? data.razao_social}
          />
        )}

        {/* Tab Agendar Atividade */}
        {activeTab === 'atividade' && (
          <LeadActivityTab leadId={data.id} />
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
                aria-label="Cancelar edição"
                className="h-10 w-10 rounded-full shadow-lg"
                onClick={handleCancelEdit}
                disabled={isPending}
              >
                <X className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="default"
                aria-label="Salvar alterações"
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
              aria-label="Editar lead"
              className="h-10 w-10 rounded-full shadow-lg"
              onClick={handleStartEdit}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      <GenerateSpicedDialog
        open={isSpicedDialogOpen}
        onOpenChange={setIsSpicedDialogOpen}
        leadId={data.id}
      />
    </div>
  );
}
