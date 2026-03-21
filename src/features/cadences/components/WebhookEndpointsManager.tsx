'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { ChevronRight, Globe, Loader2, Minus, Plus, Search, TestTube2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Separator } from '@/shared/components/ui/separator';
import { Switch } from '@/shared/components/ui/switch';

import {
  type WebhookEndpointRow,
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  fetchWebhookEndpoints,
  testWebhookEndpoint,
  updateWebhookEndpoint,
} from '../actions/webhook-endpoints-crud';

const EVENT_GROUPS = [
  {
    label: 'Email',
    events: [
      { value: 'email.sent', label: 'Email enviado' },
      { value: 'email.replied', label: 'Email respondido' },
      { value: 'email.bounced', label: 'Email bounce' },
    ],
  },
  {
    label: 'WhatsApp',
    events: [
      { value: 'whatsapp.sent', label: 'WhatsApp enviado' },
      { value: 'whatsapp.replied', label: 'WhatsApp respondido' },
      { value: 'whatsapp.failed', label: 'WhatsApp falhou' },
    ],
  },
  {
    label: 'Enrollment',
    events: [
      { value: 'enrollment.completed', label: 'Enrollment finalizado' },
      { value: 'enrollment.paused', label: 'Enrollment pausado' },
    ],
  },
  {
    label: 'CRM',
    events: [
      { value: 'crm.synced', label: 'CRM sincronizado' },
      { value: 'crm.deal_created', label: 'Deal criado no CRM' },
    ],
  },
  {
    label: 'Lead',
    events: [
      { value: 'lead.created', label: 'Lead criado' },
      { value: 'lead.enriched', label: 'Lead enriquecido' },
      { value: 'lead.qualified', label: 'Lead qualificado' },
      { value: 'lead.unqualified', label: 'Lead desqualificado' },
    ],
  },
  {
    label: 'Ligação',
    events: [
      { value: 'call.completed', label: 'Ligação completada' },
      { value: 'call.missed', label: 'Ligação perdida' },
      { value: 'call.scheduled', label: 'Reunião agendada' },
    ],
  },
] satisfies { label: string; events: { value: string; label: string }[] }[];

const ALL_EVENT_OPTIONS = EVENT_GROUPS.flatMap((g) => g.events);

export function WebhookEndpointsManager() {
  const [endpoints, setEndpoints] = useState<WebhookEndpointRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    startTransition(async () => {
      const result = await fetchWebhookEndpoints();
      if (result.success) setEndpoints(result.data);
    });
  }, []);

  function toggleEvent(event: string) {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }

  function handleCreate() {
    startTransition(async () => {
      const result = await createWebhookEndpoint({
        url,
        secret: secret || undefined,
        events: selectedEvents,
      });
      if (result.success) {
        setEndpoints((prev) => [result.data, ...prev]);
        setShowForm(false);
        setUrl('');
        setSecret('');
        setSelectedEvents([]);
        toast.success('Webhook criado');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleToggle(id: string, isActive: boolean) {
    startTransition(async () => {
      const result = await updateWebhookEndpoint(id, { is_active: isActive });
      if (result.success) {
        setEndpoints((prev) => prev.map((ep) => (ep.id === id ? result.data : ep)));
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteWebhookEndpoint(id);
      if (result.success) {
        setEndpoints((prev) => prev.filter((ep) => ep.id !== id));
        toast.success('Webhook removido');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleTest(id: string) {
    setTestingId(id);
    startTransition(async () => {
      const result = await testWebhookEndpoint(id);
      if (result.success) {
        toast.success(`Teste enviado — status ${result.data.status}`);
      } else {
        toast.error(result.error);
      }
      setTestingId(null);
    });
  }

  return (
    <Card className="mt-6">
      <CardContent className="pt-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/10 p-2">
              <Globe className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Webhooks</h3>
              <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Receba notificações em tempo real sobre eventos via HTTP POST.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
            <Plus className="mr-1 h-4 w-4" />
            Novo
          </Button>
        </div>

        {/* Create Form */}
        {showForm && (
          <div className="mt-5 space-y-4 rounded-lg border p-5">
            <div className="space-y-1">
              <Label>URL (HTTPS)</Label>
              <Input
                placeholder="https://example.com/webhook"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                O endpoint deve aceitar requisições POST e retornar status 2xx.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Secret (opcional)</Label>
              <Input
                placeholder="whsec_..."
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Usado para gerar a assinatura HMAC-SHA256 no header X-Webhook-Signature.
              </p>
            </div>

            <Separator />

            <WebhookEventPicker
              selectedEvents={selectedEvents}
              onToggleEvent={toggleEvent}
              onSetEvents={setSelectedEvents}
            />

            <Separator />

            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={isPending || !url}>
                {isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
                Criar webhook
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Empty State */}
        {endpoints.length === 0 && !showForm && (
          <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed py-10">
            <div className="rounded-lg bg-muted p-3">
              <Globe className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium">Nenhum webhook configurado</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Crie um webhook para receber eventos em tempo real.
            </p>
            <Button size="sm" variant="outline" className="mt-4" onClick={() => setShowForm(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Criar primeiro webhook
            </Button>
          </div>
        )}

        {/* Endpoints List */}
        {endpoints.length > 0 && (
          <div className="mt-5 overflow-hidden rounded-lg border">
            {endpoints.map((ep, index) => (
              <div
                key={ep.id}
                className={`group flex items-center justify-between p-3 transition-colors hover:bg-muted/50 ${
                  index < endpoints.length - 1 ? 'border-b' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{ep.url}</p>
                    <Badge variant={ep.is_active ? 'default' : 'secondary'} className="shrink-0 text-xs">
                      {ep.is_active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {ep.events.length === 0 ? (
                      <Badge variant="outline" className="text-xs">
                        Todos os eventos
                      </Badge>
                    ) : (
                      ep.events.map((e) => (
                        <Badge key={e} variant="secondary" className="text-xs">
                          {ALL_EVENT_OPTIONS.find((o) => o.value === e)?.label ?? e}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="ml-4 flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => handleTest(ep.id)}
                    disabled={testingId === ep.id}
                    title="Testar"
                  >
                    {testingId === ep.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <TestTube2 className="h-4 w-4" />
                    )}
                  </Button>
                  <Switch
                    checked={ep.is_active}
                    onCheckedChange={(checked) => handleToggle(ep.id, checked)}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-red-500 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                    onClick={() => handleDelete(ep.id)}
                    title="Remover"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Event Picker (Stripe-style accordion) ─── */

const TOTAL_EVENTS = EVENT_GROUPS.flatMap((g) => g.events).length;

function WebhookEventPicker({
  selectedEvents,
  onToggleEvent,
  onSetEvents,
}: {
  selectedEvents: string[];
  onToggleEvent: (event: string) => void;
  onSetEvents: (events: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const normalizedSearch = search.toLowerCase().trim();

  const filteredGroups = useMemo(() => {
    if (!normalizedSearch) return EVENT_GROUPS;
    return EVENT_GROUPS.map((group) => ({
      ...group,
      events: group.events.filter(
        (e) =>
          e.label.toLowerCase().includes(normalizedSearch) ||
          e.value.toLowerCase().includes(normalizedSearch),
      ),
    })).filter((group) => group.events.length > 0);
  }, [normalizedSearch]);

  function toggleGroup(label: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedEvents.length === TOTAL_EVENTS) {
      onSetEvents([]);
    } else {
      onSetEvents(EVENT_GROUPS.flatMap((g) => g.events.map((e) => e.value)));
    }
  }

  function toggleGroupEvents(group: (typeof EVENT_GROUPS)[number]) {
    const groupValues = group.events.map((e) => e.value);
    const allSelected = groupValues.every((v) => selectedEvents.includes(v));
    if (allSelected) {
      onSetEvents(selectedEvents.filter((e) => !groupValues.includes(e)));
    } else {
      const missing = groupValues.filter((v) => !selectedEvents.includes(v));
      onSetEvents([...selectedEvents, ...missing]);
    }
  }

  function selectedCountForGroup(group: (typeof EVENT_GROUPS)[number]) {
    return group.events.filter((e) => selectedEvents.includes(e.value)).length;
  }

  const allSelected = selectedEvents.length === TOTAL_EVENTS;
  const someSelected = selectedEvents.length > 0 && !allSelected;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Eventos</Label>
        {selectedEvents.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {selectedEvents.length} selecionado{selectedEvents.length !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>
      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Selecione os eventos que disparam o webhook. Deixe vazio para receber todos.
      </p>

      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        {/* Search */}
        <div className="border-b border-[var(--border)] px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              placeholder="Buscar evento..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border-0 bg-transparent py-1.5 pl-9 pr-3 text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none"
            />
          </div>
        </div>

        {/* Select all */}
        {!normalizedSearch && (
          <button
            type="button"
            onClick={toggleSelectAll}
            className="flex w-full items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 text-sm transition-colors hover:bg-[var(--accent)]"
          >
            <div
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${
                allSelected
                  ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : someSelected
                    ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'border-[var(--border)]'
              }`}
            >
              {allSelected && (
                <svg viewBox="0 0 10 8" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 4l2.5 2.5L9 1" />
                </svg>
              )}
              {someSelected && <Minus className="h-3 w-3" />}
            </div>
            <span className="font-medium">Selecionar tudo</span>
          </button>
        )}

        {/* Category groups */}
        <div className="max-h-[320px] overflow-y-auto">
          {filteredGroups.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Nenhum evento encontrado.
            </div>
          )}
          {filteredGroups.map((group) => {
            const isExpanded = expandedGroups.has(group.label) || !!normalizedSearch;
            const selectedCount = selectedCountForGroup(group);
            return (
              <div key={group.label} className="border-b border-[var(--border)] last:border-0">
                {/* Category header */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-[var(--accent)]"
                >
                  <div className="flex items-center gap-2">
                    <ChevronRight
                      className={`h-4 w-4 text-[var(--muted-foreground)] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    />
                    <span className="font-medium">{group.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedCount > 0 && (
                      <Badge variant="default" className="text-xs px-1.5 py-0">
                        {selectedCount}
                      </Badge>
                    )}
                    <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                      {group.events.length} evento{group.events.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </button>

                {/* Expanded events */}
                {isExpanded && (
                  <div className="border-t border-[var(--border)] bg-[var(--muted)]/30">
                    {/* Group select all */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleGroupEvents(group);
                      }}
                      className="flex w-full items-center gap-3 px-8 py-2 text-xs font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
                    >
                      <Checkbox
                        checked={
                          selectedCount === group.events.length
                            ? true
                            : selectedCount > 0
                              ? 'indeterminate'
                              : false
                        }
                        onCheckedChange={() => toggleGroupEvents(group)}
                        className="h-3.5 w-3.5"
                      />
                      Selecionar todos de {group.label}
                    </button>

                    {group.events.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => onToggleEvent(opt.value)}
                        className="flex w-full items-center gap-3 px-8 py-2 text-sm transition-colors hover:bg-[var(--accent)]"
                      >
                        <Checkbox
                          checked={selectedEvents.includes(opt.value)}
                          onCheckedChange={() => onToggleEvent(opt.value)}
                          className="h-3.5 w-3.5"
                        />
                        <span>{opt.label}</span>
                        <span className="ml-auto text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)] font-mono">
                          {opt.value}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
