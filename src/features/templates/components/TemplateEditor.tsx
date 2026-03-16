'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ArrowLeft, Eye, Save } from 'lucide-react';
import { toast } from 'sonner';

import { sanitizeHtml } from '@/lib/security/sanitize-html';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Textarea } from '@/shared/components/ui/textarea';

import type { ChannelType, MessageTemplateRow } from '../../cadences/types';
import { ALL_TEMPLATE_VARIABLES, extractVariables, renderTemplate } from '../index';
import { createTemplate, updateTemplate } from '../actions/manage-templates';

interface TemplateEditorProps {
  template?: MessageTemplateRow;
  signature?: string;
}

/**
 * Strips HTML tags and converts block elements to newlines for plain-text editing.
 */
function stripHtml(html: string): string {
  // Replace closing block tags with newlines, then strip all remaining tags
  return html
    .replace(/<\/p>\s*<p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Converts plain text with newlines to HTML for email rendering.
 */
function plainTextToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `<p>${line}</p>` : '<br/>'))
    .join('');
}

const sampleLeadData: Record<string, string> = {
  primeiro_nome: 'Carlos',
  empresa: 'Acme Corp',
  nome_fantasia: 'Acme Corp',
  razao_social: 'Acme Corporation LTDA',
  cnpj: '12.345.678/0001-00',
  email: 'contato@acme.com.br',
  telefone: '(11) 99999-0000',
  porte: 'ME',
  cidade: 'São Paulo',
  uf: 'SP',
  cnae: '6201-5/01',
  nome_vendedor: 'Vinicius Mercante',
  email_vendedor: 'vinicius@empresa.com.br',
};

export function TemplateEditor({ template, signature }: TemplateEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showPreview, setShowPreview] = useState(false);

  const [name, setName] = useState(template?.name ?? '');
  const [channel, setChannel] = useState<ChannelType>(template?.channel ?? 'email');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(() => stripHtml(template?.body ?? ''));

  const isEditing = !!template;
  const isSystem = template?.is_system ?? false;

  const detectedVars = extractVariables(`${subject} ${body}`);
  const previewSubject = renderTemplate(subject, sampleLeadData);
  const previewBody = renderTemplate(plainTextToHtml(body), sampleLeadData);

  function insertVariable(varName: string) {
    const insertion = `{{${varName}}}`;
    setBody((prev) => prev + insertion);
  }

  function handleSave() {
    startTransition(async () => {
      try {
        const htmlBody = channel === 'email' ? plainTextToHtml(body) : body;
        const data = { name, channel, subject: channel === 'email' ? subject : null, body: htmlBody };

        const result = isEditing
          ? await updateTemplate(template.id, data)
          : await createTemplate(data);

        if (result.success) {
          toast.success(isEditing ? 'Template atualizado' : 'Template criado');
          router.push('/templates');
        } else {
          toast.error(result.error);
        }
      } catch {
        toast.error('Erro inesperado ao salvar template');
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push('/templates')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <h1 className="text-2xl font-bold">
          {isEditing ? 'Editar Template' : 'Novo Template'}
        </h1>
        {isSystem && <Badge variant="secondary">Sistema (somente leitura)</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Editor */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuração</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome do template</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Primeiro Contato"
                  disabled={isSystem}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="channel">Canal</Label>
              <Select
                value={channel}
                onValueChange={(v) => setChannel(v as ChannelType)}
                disabled={isSystem || isEditing}
              >
                <SelectTrigger id="channel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
              </div>
            </div>

            {channel === 'email' && (
              <div className="space-y-2">
                <Label htmlFor="subject">Assunto</Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Ex: Oportunidade para {{nome_fantasia}}"
                  disabled={isSystem}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="body">Corpo da mensagem</Label>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Escreva sua mensagem aqui..."
                rows={10}
                disabled={isSystem}
              />
              {channel === 'whatsapp' && (
                <p className="text-xs text-[var(--muted-foreground)]">
                  {body.length}/4096 caracteres
                </p>
              )}
            </div>

            {/* Variable insertion */}
            <div className="space-y-2">
              <Label>Variáveis disponíveis</Label>
              <div className="flex flex-wrap gap-1">
                {ALL_TEMPLATE_VARIABLES.map((v) => (
                  <Button
                    key={v}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs font-mono"
                    disabled={isSystem}
                    onClick={() => insertVariable(v)}
                  >
                    {`{{${v}}}`}
                  </Button>
                ))}
              </div>
            </div>

            {/* Detected variables */}
            {detectedVars.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-[var(--muted-foreground)]">Variáveis detectadas:</p>
                <div className="flex flex-wrap gap-1">
                  {detectedVars.map((v) => (
                    <Badge key={v} variant="outline" className="text-xs font-mono">
                      {`{{${v}}}`}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-4">
              {!isSystem && (
                <Button onClick={handleSave} disabled={isPending}>
                  <Save className="mr-2 h-4 w-4" />
                  {isPending ? 'Salvando...' : isEditing ? 'Salvar' : 'Criar Template'}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setShowPreview(!showPreview)}
              >
                <Eye className="mr-2 h-4 w-4" />
                {showPreview ? 'Ocultar Preview' : 'Preview'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        {showPreview && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview (dados de exemplo)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {channel === 'email' && previewSubject && (
                <div>
                  <p className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">Assunto:</p>
                  <p className="font-medium">{previewSubject}</p>
                </div>
              )}
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">Mensagem:</p>
                <div className="rounded-md border bg-[var(--muted)] p-4">
                  <div
                    className="prose prose-sm max-w-none [&_p]:my-3"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(previewBody || '<span class="text-muted-foreground">Corpo vazio</span>') }}
                  />
                  {channel === 'email' && signature && (
                    <>
                      <div className="my-4 border-t border-dashed" />
                      <div
                        className="prose prose-sm max-w-none text-[var(--muted-foreground)]"
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(signature) }}
                      />
                    </>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">Dados do lead de exemplo:</p>
                <div className="space-y-1 text-xs">
                  {Object.entries(sampleLeadData).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <span className="font-mono text-[var(--muted-foreground)]">{`{{${key}}}`}</span>
                      <span>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
