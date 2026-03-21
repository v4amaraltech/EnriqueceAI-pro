'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import LinkExtension from '@tiptap/extension-link';
import { ChevronDown, ChevronRight, Eye, EyeOff, FlaskConical, Reply, Sparkles, Trash2 } from 'lucide-react';

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
import { Switch } from '@/shared/components/ui/switch';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/shared/components/ui/tabs';

import { AIMessageGenerator } from '@/features/ai/components/AIMessageGenerator';
import type { LeadContext } from '@/features/ai/types';

import type { AutoEmailStep } from '../cadence.schemas';
import type { StepAbMetrics } from '../cadences.contract';
import { fetchStepAbMetrics } from '../actions/fetch-step-ab-metrics';
import { TipTapToolbar } from './TipTapToolbar';
import { EmailPreviewPanel } from './EmailPreviewPanel';

interface AutoEmailStepEditorProps {
  step: AutoEmailStep;
  stepNumber: number;
  isFirst: boolean;
  hideDelay?: boolean;
  onChange: (step: AutoEmailStep) => void;
  onRemove: () => void;
  cadenceId?: string;
  stepId?: string;
}

const PLACEHOLDER_LEAD_CONTEXT: LeadContext = {
  nome_fantasia: 'Empresa Exemplo',
  razao_social: 'Empresa Exemplo LTDA',
  cnpj: '00.000.000/0001-00',
  email: 'contato@exemplo.com',
  telefone: '(11) 99999-0000',
  porte: 'Pequeno',
  cnae: null,
  situacao_cadastral: null,
  faturamento_estimado: null,
};

export function AutoEmailStepEditor({
  step,
  stepNumber,
  isFirst,
  hideDelay,
  onChange,
  onRemove,
  stepId,
}: AutoEmailStepEditorProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [focusedField, setFocusedField] = useState<'subject' | 'body'>('body');
  const [activeVariant, setActiveVariant] = useState<'A' | 'B'>('A');
  const [showPreview, setShowPreview] = useState(false);
  const [showAIDialog, setShowAIDialog] = useState(false);
  const [abMetrics, setAbMetrics] = useState<StepAbMetrics | null>(null);
  const [_isMetricsPending, startMetricsTransition] = useTransition();
  const subjectRef = useRef<HTMLInputElement>(null);
  const subjectBRef = useRef<HTMLInputElement>(null);

  // Load A/B metrics when step has an ID and A/B is enabled
  useEffect(() => {
    if (stepId && step.ab_enabled) {
      startMetricsTransition(async () => {
        const result = await fetchStepAbMetrics(stepId);
        if (result.success) setAbMetrics(result.data);
      });
    }
  }, [stepId, step.ab_enabled]);

  const editorA = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Escreva o corpo do email...',
      }),
      LinkExtension.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 underline cursor-pointer',
        },
      }),
    ],
    content: step.body,
    onUpdate: ({ editor: e }) => {
      onChange({ ...step, body: e.getHTML() });
    },
    onFocus: () => setFocusedField('body'),
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none min-h-[120px] p-3 focus:outline-none [&_p]:my-1',
      },
    },
  });

  const editorB = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Escreva o corpo do email (Variante B)...',
      }),
      LinkExtension.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 underline cursor-pointer',
        },
      }),
    ],
    content: step.body_b ?? '',
    onUpdate: ({ editor: e }) => {
      onChange({ ...step, body_b: e.getHTML() });
    },
    onFocus: () => setFocusedField('body'),
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none min-h-[120px] p-3 focus:outline-none [&_p]:my-1',
      },
    },
  });

  const handleInsertVariable = useCallback(
    (variable: string) => {
      const insertion = `{{${variable}}}`;
      const currentSubjectRef = activeVariant === 'A' ? subjectRef : subjectBRef;
      const currentEditor = activeVariant === 'A' ? editorA : editorB;

      if (focusedField === 'subject' && currentSubjectRef.current) {
        const input = currentSubjectRef.current;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        const newValue = input.value.slice(0, start) + insertion + input.value.slice(end);
        if (activeVariant === 'A') {
          onChange({ ...step, subject: newValue });
        } else {
          onChange({ ...step, subject_b: newValue });
        }
        requestAnimationFrame(() => {
          input.focus();
          input.setSelectionRange(start + insertion.length, start + insertion.length);
        });
      } else if (focusedField === 'body' && currentEditor) {
        currentEditor.chain().focus().insertContent(insertion).run();
      }
    },
    [focusedField, editorA, editorB, activeVariant, onChange, step],
  );

  function handleAISave(body: string, subject?: string) {
    if (activeVariant === 'A') {
      onChange({ ...step, ...(subject ? { subject } : {}), body });
      if (editorA) editorA.commands.setContent(body);
    } else {
      onChange({ ...step, ...(subject ? { subject_b: subject } : {}), body_b: body });
      if (editorB) editorB.commands.setContent(body);
    }
    setShowAIDialog(false);
  }

  const delayLabel = isFirst
    ? 'Imediato'
    : step.delay_days > 0 || step.delay_hours > 0
      ? `${step.delay_days}d ${step.delay_hours}h`
      : 'Imediato';

  return (
    <div className="rounded-lg border">
      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-lg bg-[var(--muted)] px-4 py-2.5">
        <button type="button" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? (
            <ChevronRight className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          )}
        </button>
        <span className="text-sm font-medium">Step {stepNumber}</span>
        <Badge variant="outline" className="text-xs">
          {delayLabel}
        </Badge>
        {step.ab_enabled && (
          <Badge variant="secondary" className="gap-1 text-xs bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
            <FlaskConical className="h-3 w-3" />
            A/B
          </Badge>
        )}
        {step.ai_personalization && (
          <Badge variant="secondary" className="gap-1 text-xs">
            <Sparkles className="h-3 w-3" />
            IA
          </Badge>
        )}
        {!isFirst && step.reply_type === 'reply' && (
          <Badge variant="secondary" className="gap-1 text-xs">
            <Reply className="h-3 w-3" />
            Resposta
          </Badge>
        )}
        <span className="flex-1 truncate text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          {step.reply_type === 'reply' && !isFirst
            ? 'Re: (assunto do email anterior)'
            : step.subject || 'Sem assunto'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-[var(--muted-foreground)] dark:text-[var(--foreground)]"
          onClick={() => setShowPreview(!showPreview)}
          title={showPreview ? 'Fechar preview' : 'Preview do email'}
        >
          {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-red-500"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Content */}
      {!collapsed && (
        <div className={`grid ${showPreview ? 'grid-cols-2 gap-4' : 'grid-cols-1'}`}>
          {/* Editor column */}
          <div className="space-y-4 p-4 border-r">
            {/* Delay (hidden for first step or when managed externally) */}
            {!isFirst && !hideDelay && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label htmlFor={`delay-days-${stepNumber}`} className="text-xs whitespace-nowrap">
                    Esperar
                  </Label>
                  <Input
                    id={`delay-days-${stepNumber}`}
                    type="number"
                    min={0}
                    value={step.delay_days}
                    onChange={(e) =>
                      onChange({ ...step, delay_days: parseInt(e.target.value, 10) || 0 })
                    }
                    className="w-16 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">dias</span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={step.delay_hours}
                    onChange={(e) =>
                      onChange({ ...step, delay_hours: parseInt(e.target.value, 10) || 0 })
                    }
                    className="w-16 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">horas</span>
                </div>
              </div>
            )}

            {/* Reply Type (hidden for first step) */}
            {!isFirst && (
              <div className="space-y-1.5">
                <Label className="text-sm">Tipo</Label>
                <Select
                  value={step.reply_type ?? 'new_conversation'}
                  onValueChange={(v) => onChange({ ...step, reply_type: v as 'new_conversation' | 'reply' })}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new_conversation">Nova conversa</SelectItem>
                    <SelectItem value="reply">Responder</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* A/B Toggle */}
            <div className="flex items-center gap-2">
              <Switch
                id={`ab-${stepNumber}`}
                checked={step.ab_enabled}
                onCheckedChange={(checked: boolean) => onChange({ ...step, ab_enabled: checked })}
              />
              <Label htmlFor={`ab-${stepNumber}`} className="flex items-center gap-1.5 text-sm">
                <FlaskConical className="h-3.5 w-3.5 text-purple-500" />
                Teste A/B
              </Label>
            </div>

            {/* A/B Distribution slider */}
            {step.ab_enabled && (
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">A: {step.ab_distribution ?? 50}%</span>
                <input
                  type="range"
                  min={1}
                  max={99}
                  value={step.ab_distribution ?? 50}
                  onChange={(e) => onChange({ ...step, ab_distribution: parseInt(e.target.value, 10) })}
                  className="h-1.5 w-40 cursor-pointer accent-purple-500"
                />
                <span className="text-xs font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">B: {100 - (step.ab_distribution ?? 50)}%</span>
              </div>
            )}

            {step.ab_enabled ? (
              <Tabs defaultValue="A" onValueChange={(v) => setActiveVariant(v as 'A' | 'B')}>
                <TabsList>
                  <TabsTrigger value="A">Variante A</TabsTrigger>
                  <TabsTrigger value="B">Variante B</TabsTrigger>
                </TabsList>

                {/* Variant A */}
                <TabsContent value="A" className="space-y-4 mt-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`subject-a-${stepNumber}`} className="text-sm">Assunto</Label>
                    {!isFirst && step.reply_type === 'reply' ? (
                      <p className="rounded-md border bg-[var(--muted)] px-3 py-2 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                        Re: (assunto do email anterior)
                      </p>
                    ) : (
                      <Input
                        ref={subjectRef}
                        id={`subject-a-${stepNumber}`}
                        value={step.subject}
                        onChange={(e) => onChange({ ...step, subject: e.target.value })}
                        onFocus={() => setFocusedField('subject')}
                        placeholder="Assunto da Variante A"
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Corpo do Email</Label>
                    <div className="rounded-md border focus-within:ring-1 focus-within:ring-[var(--ring)]">
                      <EditorContent editor={editorA} />
                      <TipTapToolbar
                        editor={editorA}
                        onInsertVariable={handleInsertVariable}
                        onOpenAI={() => setShowAIDialog(true)}
                      />
                    </div>
                  </div>
                </TabsContent>

                {/* Variant B */}
                <TabsContent value="B" className="space-y-4 mt-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`subject-b-${stepNumber}`} className="text-sm">Assunto</Label>
                    {!isFirst && step.reply_type === 'reply' ? (
                      <p className="rounded-md border bg-[var(--muted)] px-3 py-2 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                        Re: (assunto do email anterior)
                      </p>
                    ) : (
                      <Input
                        ref={subjectBRef}
                        id={`subject-b-${stepNumber}`}
                        value={step.subject_b ?? ''}
                        onChange={(e) => onChange({ ...step, subject_b: e.target.value })}
                        onFocus={() => setFocusedField('subject')}
                        placeholder="Assunto da Variante B"
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Corpo do Email</Label>
                    <div className="rounded-md border focus-within:ring-1 focus-within:ring-[var(--ring)]">
                      <EditorContent editor={editorB} />
                      <TipTapToolbar
                        editor={editorB}
                        onInsertVariable={handleInsertVariable}
                        onOpenAI={() => setShowAIDialog(true)}
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            ) : (
              <>
                {/* Single variant (original behavior) */}
                <div className="space-y-1.5">
                  <Label htmlFor={`subject-${stepNumber}`} className="text-sm">
                    Assunto
                  </Label>
                  {!isFirst && step.reply_type === 'reply' ? (
                    <p className="rounded-md border bg-[var(--muted)] px-3 py-2 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                      Re: (assunto do email anterior)
                    </p>
                  ) : (
                    <Input
                      ref={subjectRef}
                      id={`subject-${stepNumber}`}
                      value={step.subject}
                      onChange={(e) => onChange({ ...step, subject: e.target.value })}
                      onFocus={() => setFocusedField('subject')}
                      placeholder="Ex: {{nome_fantasia}}, temos uma oportunidade para você"
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">Corpo do Email</Label>
                  <div className="rounded-md border focus-within:ring-1 focus-within:ring-[var(--ring)]">
                    <EditorContent editor={editorA} />
                    <TipTapToolbar
                      editor={editorA}
                      onInsertVariable={handleInsertVariable}
                      onOpenAI={() => setShowAIDialog(true)}
                    />
                  </div>
                </div>
              </>
            )}

            {/* A/B Metrics panel */}
            {step.ab_enabled && abMetrics && (abMetrics.variant_a.sent > 0 || abMetrics.variant_b.sent > 0) && (
              <div className="rounded-lg border bg-[var(--muted)]/30 p-4">
                <h4 className="mb-3 text-sm font-medium">Resultados do Teste A/B</h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                      <th className="pb-2 text-left font-medium">Métrica</th>
                      <th className="pb-2 text-center font-medium">Variante A</th>
                      <th className="pb-2 text-center font-medium">Variante B</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    <tr>
                      <td className="py-1.5">Enviados</td>
                      <td className="py-1.5 text-center tabular-nums">{abMetrics.variant_a.sent}</td>
                      <td className="py-1.5 text-center tabular-nums">{abMetrics.variant_b.sent}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5">Abertos</td>
                      <td className="py-1.5 text-center tabular-nums">
                        {abMetrics.variant_a.opened}
                        {abMetrics.variant_a.sent > 0 && <span className="ml-1 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">({((abMetrics.variant_a.opened / abMetrics.variant_a.sent) * 100).toFixed(0)}%)</span>}
                      </td>
                      <td className="py-1.5 text-center tabular-nums">
                        {abMetrics.variant_b.opened}
                        {abMetrics.variant_b.sent > 0 && <span className="ml-1 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">({((abMetrics.variant_b.opened / abMetrics.variant_b.sent) * 100).toFixed(0)}%)</span>}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5">Respondidos</td>
                      <td className="py-1.5 text-center tabular-nums">
                        {abMetrics.variant_a.replied}
                        {abMetrics.variant_a.sent > 0 && <span className="ml-1 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">({((abMetrics.variant_a.replied / abMetrics.variant_a.sent) * 100).toFixed(0)}%)</span>}
                      </td>
                      <td className="py-1.5 text-center tabular-nums">
                        {abMetrics.variant_b.replied}
                        {abMetrics.variant_b.sent > 0 && <span className="ml-1 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">({((abMetrics.variant_b.replied / abMetrics.variant_b.sent) * 100).toFixed(0)}%)</span>}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5">Bounced</td>
                      <td className="py-1.5 text-center tabular-nums">{abMetrics.variant_a.bounced}</td>
                      <td className="py-1.5 text-center tabular-nums">{abMetrics.variant_b.bounced}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* AI toggle */}
            <div className="flex items-center gap-2">
              <Switch
                id={`ai-${stepNumber}`}
                checked={step.ai_personalization}
                onCheckedChange={(checked: boolean) => onChange({ ...step, ai_personalization: checked })}
              />
              <Label htmlFor={`ai-${stepNumber}`} className="flex items-center gap-1.5 text-sm">
                <Sparkles className="h-3.5 w-3.5 text-red-500" />
                Personalização com IA
              </Label>
            </div>
          </div>

          {/* Preview column */}
          {showPreview && (
            <div className="overflow-y-auto">
              <EmailPreviewPanel
                subject={activeVariant === 'B' && step.ab_enabled ? (step.subject_b ?? '') : step.subject}
                body={activeVariant === 'B' && step.ab_enabled ? (step.body_b ?? '') : step.body}
              />
            </div>
          )}
        </div>
      )}

      {/* AI Dialog */}
      <AIMessageGenerator
        open={showAIDialog}
        onOpenChange={setShowAIDialog}
        leadContext={PLACEHOLDER_LEAD_CONTEXT}
        onSaveAsTemplate={handleAISave}
      />
    </div>
  );
}
