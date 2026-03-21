'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { sanitizeHtml } from '@/lib/security/sanitize-html';
import {
  Bell,
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  FileText,
  Linkedin,
  Mail,
  MessageSquare,
  MousePointerClick,
  Pencil,
  Phone,
  Plus,
  Reply,
  Save,
  Search,
  Send,
  Trash2,
  User,
  Video,
  X,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import { scheduleMeeting } from '@/features/integrations/actions/schedule-meeting';

import { LEAD_SOURCE_OPTIONS } from '../schemas/lead.schemas';
import type { LeadPhone } from '../types';
import { updateLead } from '../actions/update-lead';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

import type { TimelineEntry } from '@/features/cadences/cadences.contract';
import type { InteractionType } from '@/features/cadences/types';


import { LeadNotes } from './LeadNotes';
import { MeetimeFieldRow } from './MeetimeFieldRow';
import { EngagementScoreBadge } from './EngagementScoreBadge';
import type { LeadInfoPanelData } from './lead-info-panel.utils';

export interface LeadInfoPanelProps {
  data: LeadInfoPanelData;
  enrollment?: { cadence_name: string; enrolled_by_email: string | null } | null;
  enrollments?: Array<{ cadence_name: string; enrolled_by_email: string | null }>;
  timeline?: TimelineEntry[];
  showLeadHeader?: boolean;
  cadenceConfig?: { cadenceName: string; stepOrder: number; totalSteps: number };
  kpis?: { completed: number; open: number; conversations: number };
}

type TabId = 'dados' | 'timeline' | 'notas' | 'agendar';

const typeConfig: Record<InteractionType, { label: string; icon: typeof Send; className: string }> = {
  sent: { label: 'Enviado', icon: Send, className: 'text-blue-500' },
  delivered: { label: 'Entregue', icon: Check, className: 'text-green-500' },
  opened: { label: 'Aberto', icon: Mail, className: 'text-[var(--primary)]' },
  clicked: { label: 'Clicou', icon: MousePointerClick, className: 'text-orange-500' },
  replied: { label: 'Respondeu', icon: Reply, className: 'text-emerald-600' },
  bounced: { label: 'Bounce', icon: XCircle, className: 'text-red-500' },
  failed: { label: 'Falhou', icon: XCircle, className: 'text-red-600' },
  meeting_scheduled: { label: 'Reunião', icon: Calendar, className: 'text-indigo-500' },
};

const channelIcon: Record<string, typeof Mail> = {
  email: Mail,
  whatsapp: MessageSquare,
  phone: Phone,
  linkedin: Linkedin,
  research: Search,
};

function formatTimelineDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH = Math.floor(diffMs / 3_600_000);

  if (diffMin < 5) return 'AGORA';
  if (diffMin < 60) return `${diffMin}min`;
  if (diffH < 24 && date.getDate() === now.getDate()) return 'HOJE';

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth()) return 'ONTEM';

  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

const channelLabel: Record<string, string> = {
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  phone: 'Telefone',
  linkedin: 'LinkedIn',
  research: 'Pesquisa',
};

const channelColor: Record<string, string> = {
  email: 'bg-blue-500',
  whatsapp: 'bg-emerald-500',
  phone: 'bg-amber-500',
  linkedin: 'bg-[#0A66C2]',
  research: 'bg-violet-500',
};

export function LeadInfoPanel({
  data: initialData,
  enrollment: _enrollment,
  enrollments: _enrollments,
  timeline,
  showLeadHeader = false,
  cadenceConfig: _cadenceConfig,
  kpis,
}: LeadInfoPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

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

  // Meeting scheduling states
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingTime, setMeetingTime] = useState('09:00');
  const [meetingDuration, setMeetingDuration] = useState('30');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingAttendee, setMeetingAttendee] = useState('');
  const [meetingMeetLink, setMeetingMeetLink] = useState(true);
  const [isMeetingPending, startMeetingTransition] = useTransition();

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
        }));
        toast.success('Lead atualizado');
        setIsEditing(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [data.id, editFields, phoneEntries, router]);

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

  // Notable events for bell icon (replies, meetings, bounces)
  const notableTypes: InteractionType[] = ['replied', 'meeting_scheduled', 'bounced'];
  const notableEvents = (timeline ?? []).filter((e) => notableTypes.includes(e.type));
  const notableCount = notableEvents.length;

  return (
    <div className={`flex h-full shrink-0 flex-col ${showLeadHeader ? 'w-full' : 'w-80'}`}>
      {/* Lead header — avatar + name + actions shown only in activity execution */}
      {showLeadHeader && (
      <div className="mb-20 flex items-center gap-3">
        <div className="relative">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/10 text-lg font-semibold text-[var(--primary)]">
            {avatarInitial}
          </div>
          {data.fit_score != null && data.fit_score > 0 && (
            <span className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
              {data.fit_score}
            </span>
          )}
          {data.engagement_score != null && (
            <span className="absolute -top-1 -left-1">
              <EngagementScoreBadge score={data.engagement_score} size={22} />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{headerName}</p>
          {headerCompany && (
            <p className="truncate text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{headerCompany}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-8 w-8" title="Notificações do lead">
              <Bell className="h-4 w-4" />
              {notableCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white">
                  {notableCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <p className="px-2 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Notificações do Lead
            </p>
            {notableCount === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Nenhuma notificação
              </div>
            ) : (
              notableEvents.slice(0, 8).map((entry) => {
                const config = typeConfig[entry.type];
                const Icon = config.icon;
                const ChannelIcon = channelIcon[entry.channel] ?? Mail;
                return (
                  <DropdownMenuItem key={entry.id} className="flex gap-2 py-2" onSelect={() => setActiveTab('timeline')}>
                    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] ${config.className}`}>
                      <Icon className="h-3 w-3" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-medium">{config.label}</span>
                        <ChannelIcon className="h-3 w-3 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                      </div>
                      {entry.cadence_name && (
                        <p className="truncate text-[10px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                          {entry.cadence_name}
                        </p>
                      )}
                      <p className="text-[10px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                        {formatTimelineDate(entry.created_at)}
                      </p>
                    </div>
                  </DropdownMenuItem>
                );
              })
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => window.open(`/leads/${data.id}`, '_blank')}
            >
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Ver lead completo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>
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
                      {LEAD_SOURCE_OPTIONS.map((opt) => (
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
                  value={LEAD_SOURCE_OPTIONS.find((o) => o.value === data.lead_source)?.label ?? data.lead_source ?? '—'}
                />
              )}
            </div>
          </div>
        )}

        {/* Tab Timeline */}
        {activeTab === 'timeline' && (
          <div className="space-y-1">
            {!timeline || timeline.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Nenhuma interação registrada.
              </p>
            ) : (
              timeline.map((entry) => {
                const ChannelIcon = channelIcon[entry.channel] ?? Mail;
                const label = channelLabel[entry.channel] ?? entry.channel;
                const bgColor = channelColor[entry.channel] ?? 'bg-[var(--muted)]';
                const relDate = formatRelativeDate(entry.created_at);
                const stepLabel = entry.step_order != null ? ` ${entry.step_order}` : '';

                return (
                  <div key={entry.id} className="flex gap-3 rounded-lg p-3 hover:bg-[var(--muted)]/50 transition-colors">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${bgColor} text-white`}>
                      <ChannelIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {relDate === 'AGORA' && (
                            <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              AGORA
                            </span>
                          )}
                          <span className="text-sm font-semibold">
                            {label}{stepLabel}
                          </span>
                          {entry.ai_generated && (
                            <Badge variant="outline" className="h-4 px-1 text-[10px]">IA</Badge>
                          )}
                        </div>
                        {relDate !== 'AGORA' && (
                          <span className="shrink-0 text-[11px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                            {relDate}
                          </span>
                        )}
                      </div>
                      {entry.message_content ? (
                        <div
                          className="mt-1 whitespace-pre-line text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)] [&_a]:text-[var(--primary)] [&_a]:underline"
                          dangerouslySetInnerHTML={{
                            __html: sanitizeHtml(
                              entry.message_content
                                .replace(/\{\{[^}]+\}\}/g, '')
                                .replace(/\s{2,}/g, ' ')
                                .trim(),
                            ),
                          }}
                        />
                      ) : (
                        <p className="mt-1 text-xs italic text-[var(--muted-foreground)] dark:text-[var(--foreground)]/60">
                          Nenhuma anotação
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Tab Notas */}
        {activeTab === 'notas' && (
          <LeadNotes leadId={data.id} notes={null} />
        )}

        {/* Tab Agendar */}
        {activeTab === 'agendar' && (
          <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Agendar Reunião
            </h4>

            <div>
              <Label className="text-xs">Título</Label>
              <Input
                value={meetingTitle}
                onChange={(e) => setMeetingTitle(e.target.value)}
                placeholder={`Reunião com ${data.nome_fantasia ?? data.razao_social ?? 'Lead'}`}
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Data</Label>
                <Input
                  type="date"
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Hora</Label>
                <Input
                  type="time"
                  value={meetingTime}
                  onChange={(e) => setMeetingTime(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Duração</Label>
              <select
                className="mt-1 flex h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-sm"
                value={meetingDuration}
                onChange={(e) => setMeetingDuration(e.target.value)}
              >
                <option value="15">15 min</option>
                <option value="30">30 min</option>
                <option value="45">45 min</option>
                <option value="60">1 hora</option>
                <option value="90">1h30</option>
              </select>
            </div>

            <div>
              <Label className="text-xs">Email do closer (participante)</Label>
              <Input
                type="email"
                value={meetingAttendee}
                onChange={(e) => setMeetingAttendee(e.target.value)}
                placeholder="closer@empresa.com"
                className="mt-1"
              />
            </div>

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={meetingMeetLink}
                onChange={(e) => setMeetingMeetLink(e.target.checked)}
                className="rounded"
              />
              <Video className="h-3.5 w-3.5" />
              Gerar link do Google Meet
            </label>

            <Button
              className="w-full"
              disabled={!meetingDate || !meetingTime || isMeetingPending}
              onClick={() => {
                const startDateTime = new Date(`${meetingDate}T${meetingTime}:00`);
                const endDateTime = new Date(startDateTime.getTime() + parseInt(meetingDuration, 10) * 60 * 1000);
                const title = meetingTitle || `Reunião com ${data.nome_fantasia ?? data.razao_social ?? 'Lead'}`;

                startMeetingTransition(async () => {
                  const result = await scheduleMeeting(data.id, {
                    title,
                    startTime: startDateTime.toISOString(),
                    endTime: endDateTime.toISOString(),
                    attendeeEmails: (meetingAttendee || data.email)
                      ? (meetingAttendee || data.email || '').split(',').map((e: string) => e.trim()).filter(Boolean)
                      : undefined,
                    generateMeetLink: meetingMeetLink,
                  });

                  if (result.success) {
                    const meetInfo = result.data.meetLink ? ` | Meet: ${result.data.meetLink}` : '';
                    toast.success(`Reunião agendada!${meetInfo}`);
                    setMeetingDate('');
                    setMeetingTitle('');
                    router.refresh();
                  } else {
                    toast.error(result.error);
                  }
                });
              }}
            >
              <Calendar className="mr-2 h-4 w-4" />
              {isMeetingPending ? 'Agendando...' : 'Agendar Reunião'}
            </Button>
          </div>
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
