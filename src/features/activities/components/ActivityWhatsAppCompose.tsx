'use client';

import { useRef } from 'react';

import { Clock, Eye, Loader2, Send, Sparkles } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
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
import { Textarea } from '@/shared/components/ui/textarea';

import { VariableInsertBar } from '@/features/cadences/components/VariableInsertBar';

import type { ResolvedPhone } from '../utils/resolve-whatsapp-phone';
import type { WhatsAppTemplateOption } from '../actions/fetch-whatsapp-templates';

interface ActivityWhatsAppComposeProps {
  to: string;
  body: string;
  renderedPreview: string;
  aiPersonalized: boolean;
  isLoading: boolean;
  isSending: boolean;
  phones: ResolvedPhone[];
  templates: WhatsAppTemplateOption[];
  currentTemplateId: string | null;
  onPhoneChange: (phone: string) => void;
  onBodyChange: (value: string) => void;
  onTemplateChange: (templateId: string) => void;
  onSend: () => void;
  onSkip: () => void;
}

export function ActivityWhatsAppCompose({
  to,
  body,
  renderedPreview,
  aiPersonalized,
  isLoading,
  isSending,
  phones,
  templates,
  currentTemplateId,
  onPhoneChange,
  onBodyChange,
  onTemplateChange,
  onSend,
  onSkip,
}: ActivityWhatsAppComposeProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = !isSending && !isLoading && to && body.trim();

  function handleInsertVariable(variable: string) {
    const el = textareaRef.current;
    const tag = `{{${variable}}}`;
    if (el) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newBody = body.slice(0, start) + tag + body.slice(end);
      onBodyChange(newBody);
      // Restore cursor after the inserted variable
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + tag.length, start + tag.length);
      });
    } else {
      onBodyChange(body + tag);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Compor WhatsApp
        </h3>
        {aiPersonalized && (
          <Badge variant="outline" className="gap-1 text-xs">
            <Sparkles className="h-3 w-3" />
            Personalizado por IA
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
          <span className="ml-2 text-sm text-[var(--muted-foreground)]">Preparando mensagem...</span>
        </div>
      ) : (
        <>
          <div className="mt-3 space-y-3 flex-1">
            {/* Phone field */}
            <div className="space-y-1">
              <Label className="text-xs">Para (telefone)</Label>
              {phones.length > 1 ? (
                <Select value={to} onValueChange={onPhoneChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o telefone" />
                  </SelectTrigger>
                  <SelectContent>
                    {phones.map((phone) => (
                      <SelectItem key={phone.raw} value={phone.formatted}>
                        {phone.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={to}
                  readOnly
                  className="bg-[var(--muted)]"
                  placeholder={!to ? 'Lead sem telefone cadastrado' : undefined}
                />
              )}
            </div>

            {/* Template selector — above message field */}
            {templates.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Template</Label>
                <Select
                  value={currentTemplateId ?? 'none'}
                  onValueChange={(val) => {
                    if (val !== 'none') onTemplateChange(val);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Message textarea — shows resolved variables */}
            <div className="flex flex-col space-y-1">
              <Label className="text-xs">Mensagem</Label>
              <Textarea
                ref={textareaRef}
                value={renderedPreview}
                onChange={(e) => onBodyChange(e.target.value)}
                placeholder="Mensagem WhatsApp"
                className="min-h-[150px] resize-none"
              />
            </div>

            {/* Variable insert bar */}
            <VariableInsertBar onInsert={handleInsertVariable} disabled={isSending} />

            {/* Preview — always visible below */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Eye className="h-3 w-3 text-[var(--muted-foreground)]" />
                <Label className="text-xs">Preview</Label>
              </div>
              <div className="min-h-[80px] overflow-auto rounded-lg bg-[#dcf8c6] p-3 text-sm whitespace-pre-wrap dark:bg-[#025144] dark:text-[#e9edef]">
                {renderedPreview || <span className="italic text-[var(--muted-foreground)]">Sem conteúdo</span>}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="outline" onClick={onSkip} disabled={isSending}>
              <Clock className="mr-2 h-4 w-4" />
              Pular
            </Button>
            <Button onClick={onSend} disabled={!canSend} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {isSending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Enviar WhatsApp
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
