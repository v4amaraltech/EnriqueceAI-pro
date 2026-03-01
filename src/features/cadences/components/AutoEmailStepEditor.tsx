'use client';

import { useCallback, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import LinkExtension from '@tiptap/extension-link';
import { ChevronDown, ChevronRight, Eye, EyeOff, Sparkles, Trash2 } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Switch } from '@/shared/components/ui/switch';

import { AIMessageGenerator } from '@/features/ai/components/AIMessageGenerator';
import type { LeadContext } from '@/features/ai/types';

import type { AutoEmailStep } from '../cadence.schemas';
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
}: AutoEmailStepEditorProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [focusedField, setFocusedField] = useState<'subject' | 'body'>('body');
  const [showPreview, setShowPreview] = useState(false);
  const [showAIDialog, setShowAIDialog] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
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

  const handleInsertVariable = useCallback(
    (variable: string) => {
      const insertion = `{{${variable}}}`;
      if (focusedField === 'subject' && subjectRef.current) {
        const input = subjectRef.current;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        const newValue = input.value.slice(0, start) + insertion + input.value.slice(end);
        onChange({ ...step, subject: newValue });
        requestAnimationFrame(() => {
          input.focus();
          input.setSelectionRange(start + insertion.length, start + insertion.length);
        });
      } else if (focusedField === 'body' && editor) {
        editor.chain().focus().insertContent(insertion).run();
      }
    },
    [focusedField, editor, onChange, step],
  );

  function handleAISave(body: string, subject?: string) {
    if (subject) {
      onChange({ ...step, subject, body });
    } else {
      onChange({ ...step, body });
    }
    if (editor) {
      editor.commands.setContent(body);
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
            <ChevronRight className="h-4 w-4 text-[var(--muted-foreground)]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
          )}
        </button>
        <span className="text-sm font-medium">Step {stepNumber}</span>
        <Badge variant="outline" className="text-xs">
          {delayLabel}
        </Badge>
        {step.ai_personalization && (
          <Badge variant="secondary" className="gap-1 text-xs">
            <Sparkles className="h-3 w-3" />
            IA
          </Badge>
        )}
        <span className="flex-1 truncate text-xs text-[var(--muted-foreground)]">
          {step.subject || 'Sem assunto'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-[var(--muted-foreground)]"
          onClick={() => setShowPreview(!showPreview)}
          title={showPreview ? 'Fechar preview' : 'Preview do email'}
        >
          {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-[var(--muted-foreground)] hover:text-red-500"
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
                  <span className="text-xs text-[var(--muted-foreground)]">dias</span>
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
                  <span className="text-xs text-[var(--muted-foreground)]">horas</span>
                </div>
              </div>
            )}

            {/* Subject */}
            <div className="space-y-1.5">
              <Label htmlFor={`subject-${stepNumber}`} className="text-sm">
                Assunto
              </Label>
              <Input
                ref={subjectRef}
                id={`subject-${stepNumber}`}
                value={step.subject}
                onChange={(e) => onChange({ ...step, subject: e.target.value })}
                onFocus={() => setFocusedField('subject')}
                placeholder="Ex: {{nome_fantasia}}, temos uma oportunidade para você"
              />
            </div>

            {/* Body (TipTap) with integrated toolbar */}
            <div className="space-y-1.5">
              <Label className="text-sm">Corpo do Email</Label>
              <div className="rounded-md border focus-within:ring-1 focus-within:ring-[var(--ring)]">
                <EditorContent editor={editor} />
                <TipTapToolbar
                  editor={editor}
                  onInsertVariable={handleInsertVariable}
                  onOpenAI={() => setShowAIDialog(true)}
                />
              </div>
            </div>

            {/* AI toggle */}
            <div className="flex items-center gap-2">
              <Switch
                id={`ai-${stepNumber}`}
                checked={step.ai_personalization}
                onCheckedChange={(checked: boolean) => onChange({ ...step, ai_personalization: checked })}
              />
              <Label htmlFor={`ai-${stepNumber}`} className="flex items-center gap-1.5 text-sm">
                <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                Personalização com IA
              </Label>
            </div>
          </div>

          {/* Preview column */}
          {showPreview && (
            <div className="overflow-y-auto">
              <EmailPreviewPanel subject={step.subject} body={step.body} />
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
