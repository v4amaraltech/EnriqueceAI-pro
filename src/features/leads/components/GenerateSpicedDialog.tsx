'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';

import { generateSpicedFromText } from '@/features/calls/actions/generate-spiced-from-text';

interface GenerateSpicedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
}

export function GenerateSpicedDialog({ open, onOpenChange, leadId }: GenerateSpicedDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [text, setText] = useState('');

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (trimmed.length < 50) {
      toast.error('Resumo precisa ter ao menos 50 caracteres');
      return;
    }
    startTransition(async () => {
      const result = await generateSpicedFromText({ leadId, text: trimmed });
      if (result.success) {
        toast.success('SPICED gerado com sucesso');
        setText('');
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-red-500" />
            Gerar SPICED via IA
          </DialogTitle>
          <DialogDescription>
            Cole o resumo da conversa (transcrição, anotações da ligação, troca de mensagens, etc.).
            A IA preencherá automaticamente os campos S, P, I, CE, E, D, Oportunidades, Gaps e Observação Decisor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={isPending}
            placeholder="Cole aqui o resumo da conversa, transcrição da ligação ou anotações detalhadas do que foi discutido com o lead..."
            className="w-full min-h-[280px] resize-y rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
          <p className="text-xs text-[var(--muted-foreground)]">
            {text.trim().length} caracteres (mínimo 50)
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || text.trim().length < 50}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Gerando...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Gerar SPICED
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
