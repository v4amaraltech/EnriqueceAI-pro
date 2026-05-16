'use client';

import { useState, useTransition } from 'react';
import { Check, Copy, RefreshCw, Save, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Textarea } from '@/shared/components/ui/textarea';

import { generateMessageAction, getAIUsageAction } from '../actions/generate-message';
import type { AIUsageInfo, ChannelTarget, LeadContext, ToneOption } from '../types';

interface AIMessageGeneratorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadContext: LeadContext;
  onSaveAsTemplate?: (body: string, subject?: string) => void;
}

const TONE_LABELS: Record<ToneOption, string> = {
  professional: 'Profissional',
  consultative: 'Consultivo',
  direct: 'Direto',
  friendly: 'Amigável',
};

const CHANNEL_LABELS: Record<ChannelTarget, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
};

export function AIMessageGenerator({
  open,
  onOpenChange,
  leadContext,
  onSaveAsTemplate,
}: AIMessageGeneratorProps) {
  const [isPending, startTransition] = useTransition();
  const [channel, setChannel] = useState<ChannelTarget>('email');
  const [tone, setTone] = useState<ToneOption>('professional');
  const [additionalContext, setAdditionalContext] = useState('');
  const [generatedSubject, setGeneratedSubject] = useState('');
  const [generatedBody, setGeneratedBody] = useState('');
  const [isGenerated, setIsGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [usage, setUsage] = useState<AIUsageInfo | null>(null);

  function handleGenerate() {
    startTransition(async () => {
      const result = await generateMessageAction({
        channel,
        tone,
        leadContext,
        additionalContext: additionalContext || undefined,
      });

      if (result.success) {
        setGeneratedSubject(result.data.subject ?? '');
        setGeneratedBody(result.data.body);
        setIsGenerated(true);
        toast.success('Mensagem gerada com sucesso');

        // Refresh usage counter
        const usageResult = await getAIUsageAction();
        if (usageResult.success) setUsage(usageResult.data);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleCopy() {
    const text = channel === 'email' && generatedSubject
      ? `Assunto: ${generatedSubject}\n\n${generatedBody}`
      : generatedBody;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copiado para a área de transferência');
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSaveAsTemplate() {
    onSaveAsTemplate?.(generatedBody, generatedSubject || undefined);
    toast.success('Redirecionando para criar template...');
  }

  function handleReset() {
    setIsGenerated(false);
    setGeneratedSubject('');
    setGeneratedBody('');
    setCopied(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-h-[85vh] overflow-hidden border-[var(--border)] bg-[var(--card)] shadow-2xl ring-1 ring-white/10 ${isGenerated ? '!max-w-[900px]' : 'max-w-2xl'}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[var(--primary)]" />
            Gerar Mensagem com IA
          </DialogTitle>
        </DialogHeader>

        <div className={isGenerated ? 'grid min-h-0 grid-cols-[340px_1fr] gap-6 overflow-y-auto' : 'space-y-4 overflow-y-auto'}>
          {/* Left column: config */}
          <div className="space-y-3">
            {/* Config row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Canal</Label>
                <Select
                  value={channel}
                  onValueChange={(v) => { setChannel(v as ChannelTarget); handleReset(); }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CHANNEL_LABELS) as ChannelTarget[]).map((ch) => (
                      <SelectItem key={ch} value={ch}>
                        {CHANNEL_LABELS[ch]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Tom</Label>
                <Select
                  value={tone}
                  onValueChange={(v) => { setTone(v as ToneOption); handleReset(); }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TONE_LABELS) as ToneOption[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TONE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Lead context preview */}
            <div className="rounded-md border bg-[var(--muted)] p-2.5">
              <p className="mb-1 text-xs font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Contexto do Lead</p>
              <p className="text-sm font-medium">
                {leadContext.nome_fantasia ?? leadContext.razao_social}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {leadContext.porte && <Badge variant="outline" className="text-xs">{leadContext.porte}</Badge>}
                {leadContext.cnae && <Badge variant="outline" className="text-xs">{leadContext.cnae}</Badge>}
                {leadContext.endereco?.cidade && (
                  <Badge variant="outline" className="text-xs">
                    {leadContext.endereco.cidade}/{leadContext.endereco.uf}
                  </Badge>
                )}
              </div>
            </div>

            {/* Additional context */}
            <div className="space-y-1">
              <Label htmlFor="ai-context">Contexto adicional (opcional)</Label>
              <Textarea
                id="ai-context"
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                placeholder="Ex: Oferecer desconto de 20%, mencionar evento do setor..."
                rows={2}
              />
            </div>

            {/* Generate / Regenerate button */}
            <Button
              className="w-full"
              variant={isGenerated ? 'outline' : 'default'}
              onClick={handleGenerate}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Gerando...
                </>
              ) : isGenerated ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Regenerar
                </>
              ) : (
                <>
                  <Wand2 className="mr-2 h-4 w-4" />
                  Gerar Mensagem
                </>
              )}
            </Button>

            {/* Usage counter */}
            {usage && (
              <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Uso hoje: {usage.used} / {usage.limit === -1 ? '∞' : usage.limit} gerações
                {usage.remaining !== -1 && ` (${usage.remaining} restantes)`}
              </p>
            )}
          </div>

          {/* Right column: generated preview */}
          {isGenerated && (
            <div className="flex min-h-0 flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Mensagem Gerada</p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    {copied ? (
                      <><Check className="mr-1 h-3.5 w-3.5" /> Copiado</>
                    ) : (
                      <><Copy className="mr-1 h-3.5 w-3.5" /> Copiar</>
                    )}
                  </Button>
                  {onSaveAsTemplate && (
                    <Button size="sm" onClick={handleSaveAsTemplate}>
                      <Save className="mr-1 h-3.5 w-3.5" />
                      Usar no Template
                    </Button>
                  )}
                </div>
              </div>

              {channel === 'email' && (
                <div className="space-y-1">
                  <Label htmlFor="ai-subject">Assunto</Label>
                  <input
                    id="ai-subject"
                    className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                    value={generatedSubject}
                    onChange={(e) => setGeneratedSubject(e.target.value)}
                  />
                </div>
              )}

              <div className="flex min-h-0 flex-1 flex-col gap-1">
                <Label htmlFor="ai-body">Corpo</Label>
                <Textarea
                  id="ai-body"
                  className="min-h-0 flex-1 resize-none"
                  value={generatedBody}
                  onChange={(e) => setGeneratedBody(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
