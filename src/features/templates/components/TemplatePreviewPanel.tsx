'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Monitor, RefreshCw, Search, Smartphone } from 'lucide-react';

import { sanitizeHtml } from '@/lib/security/sanitize-html';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import { fetchGmailSignature } from '@/features/activities/actions/fetch-gmail-signature';
import { fetchLeadsForPreview, type PreviewLead } from '@/features/cadences/actions/fetch-leads-for-preview';
import { fetchVendorVariables, type VendorVariables } from '@/features/cadences/actions/fetch-vendor-variables';
import { buildLeadTemplateVariables } from '@/features/cadences/utils/build-template-variables';
import { renderTemplate } from '@/features/cadences/utils/render-template';

import type { ChannelType } from '../../cadences/types';

interface TemplatePreviewPanelProps {
  subject: string;
  body: string;
  channel: ChannelType;
}

export function TemplatePreviewPanel({ subject, body, channel }: TemplatePreviewPanelProps) {
  const [leads, setLeads] = useState<PreviewLead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string>('');
  const [vendorVars, setVendorVars] = useState<VendorVariables>({ nome_vendedor: null, email_vendedor: null });
  const [signature, setSignature] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>(channel === 'whatsapp' ? 'mobile' : 'desktop');
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  function loadLeads(searchTerm?: string) {
    startTransition(async () => {
      const result = await fetchLeadsForPreview(searchTerm, 20);
      if (result.success) {
        setLeads(result.data);
        if (result.data.length > 0 && !searchTerm) {
          const first = result.data[0];
          if (first) setSelectedLeadId(first.id);
        }
      }
    });
  }

  useEffect(() => {
    loadLeads();
    fetchVendorVariables().then((r) => {
      if (r.success) setVendorVars(r.data);
    });
    if (channel === 'email') {
      fetchGmailSignature().then((r) => {
        if (r.success && r.data) setSignature(r.data);
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadLeads(value || undefined);
    }, 300);
  }

  const selectedLead = leads.find((l) => l.id === selectedLeadId);

  const variables = {
    ...(selectedLead ? buildLeadTemplateVariables(selectedLead) : {}),
    ...vendorVars,
  };

  const renderedSubject = renderTemplate(subject, variables);
  const renderedBody = renderTemplate(body, variables);

  const isEmail = channel === 'email';

  return (
    <div className="flex h-full flex-col rounded-lg border bg-[var(--card)]">
      {/* Header */}
      <div className="space-y-3 border-b p-4">
        <Label className="text-sm font-medium">Gerar prévia para contato</Label>

        {/* Search */}
        <div className="relative">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Buscar lead..."
            className="pl-9"
          />
        </div>

        {/* Lead select */}
        <Select value={selectedLeadId} onValueChange={setSelectedLeadId}>
          <SelectTrigger>
            <SelectValue placeholder={isPending ? 'Carregando...' : 'Selecione um lead'} />
          </SelectTrigger>
          <SelectContent>
            {leads.map((lead) => (
              <SelectItem key={lead.id} value={lead.id}>
                {lead.nome_fantasia ?? lead.razao_social ?? lead.cnpj}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadLeads(search || undefined)}
            disabled={isPending}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>

          {isEmail && (
            <div className="ml-auto flex items-center gap-1 rounded-md border p-0.5">
              <Button
                type="button"
                variant={viewMode === 'desktop' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setViewMode('desktop')}
                title="Desktop"
              >
                <Monitor className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant={viewMode === 'mobile' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setViewMode('mobile')}
                title="Mobile"
              >
                <Smartphone className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="flex-1 overflow-auto p-4">
        {!selectedLead ? (
          <p className="text-center text-sm text-[var(--muted-foreground)]">
            Selecione um lead para visualizar o preview
          </p>
        ) : isEmail ? (
          <div className={`mx-auto ${viewMode === 'mobile' ? 'max-w-[375px]' : 'max-w-full'}`}>
            {/* Email header */}
            <div className="mb-4 space-y-1 border-b pb-3 text-sm">
              <p className="text-[var(--muted-foreground)]">
                <span className="font-medium text-[var(--foreground)]">Para: </span>
                {selectedLead.primeiro_nome ?? selectedLead.nome_fantasia ?? 'Lead'}{' '}
                {selectedLead.email && (
                  <span className="text-[var(--muted-foreground)]">
                    &lt;{selectedLead.email}&gt;
                  </span>
                )}
              </p>
              <p>
                <span className="font-medium">Assunto: </span>
                {renderedSubject || '(sem assunto)'}
              </p>
            </div>

            {/* Email body */}
            <div
              className="prose prose-sm max-w-none [&_p]:my-3"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderedBody || '<p class="text-muted-foreground">(corpo vazio)</p>') }}
            />

            {/* Signature */}
            {signature && (
              <>
                <div className="my-4 border-t border-dashed" />
                <div
                  className="prose prose-sm max-w-none text-[var(--muted-foreground)]"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(signature) }}
                />
              </>
            )}
          </div>
        ) : (
          /* WhatsApp preview */
          <div className="mx-auto max-w-[375px]">
            <div className="rounded-lg bg-[#e5ddd5] p-3 dark:bg-[#0b141a]">
              <div className="ml-auto max-w-[85%] rounded-lg bg-[#dcf8c6] px-3 py-2 dark:bg-[#005c4b]">
                <p className="whitespace-pre-wrap text-sm text-[#111b21] dark:text-[#e9edef]">
                  {renderedBody || '(mensagem vazia)'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
