'use client';

import { useEffect, useState, useTransition } from 'react';
import { Globe, Loader2, Plus, TestTube2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-[var(--muted-foreground)]" />
            <CardTitle className="text-base">Webhooks</CardTitle>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
            <Plus className="mr-1 h-4 w-4" />
            Novo
          </Button>
        </div>

        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Receba notificações em tempo real sobre eventos de cadência via HTTP POST.
        </p>

        {showForm && (
          <div className="mt-4 space-y-3 rounded-md border p-4">
            <div>
              <Label>URL (HTTPS)</Label>
              <Input
                placeholder="https://example.com/webhook"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div>
              <Label>Secret (opcional, para assinatura HMAC)</Label>
              <Input
                placeholder="whsec_..."
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </div>
            <div>
              <Label>Eventos (vazio = todos)</Label>
              <div className="mt-2 space-y-3">
                {EVENT_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">{group.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {group.events.map((opt) => (
                        <Badge
                          key={opt.value}
                          variant={selectedEvents.includes(opt.value) ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => toggleEvent(opt.value)}
                        >
                          {opt.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={isPending || !url}>
                {isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Criar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {endpoints.length === 0 && !showForm && (
          <p className="mt-4 text-sm text-[var(--muted-foreground)]">
            Nenhum webhook configurado.
          </p>
        )}

        {endpoints.length > 0 && (
          <div className="mt-4 space-y-3">
            {endpoints.map((ep) => (
              <div
                key={ep.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{ep.url}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {ep.events.length === 0 ? (
                      <Badge variant="secondary" className="text-xs">Todos os eventos</Badge>
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
                    className="h-8 w-8"
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
                    className="h-8 w-8 text-red-500 hover:text-red-600"
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
