'use client';

import { useRouter } from 'next/navigation';
import { Mail, Zap } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

interface CadenceTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CadenceTypeDialog({ open, onOpenChange }: CadenceTypeDialogProps) {
  const router = useRouter();

  function handleSelect(type: 'standard' | 'auto_email') {
    onOpenChange(false);
    if (type === 'auto_email') {
      router.push('/cadences/new?type=auto_email');
    } else {
      router.push('/cadences/new');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tipo de Cadência</DialogTitle>
          <DialogDescription>
            Escolha o tipo de cadência que deseja criar.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            onClick={() => handleSelect('standard')}
            className="flex flex-col items-center gap-3 rounded-lg border-2 border-transparent bg-[var(--muted)] p-5 text-center transition-colors hover:border-[var(--primary)] hover:bg-[var(--muted)]/80"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
              <Zap className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="font-medium">Padrão</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Multi-canal: email, WhatsApp, telefone, LinkedIn
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => handleSelect('auto_email')}
            className="flex flex-col items-center gap-3 rounded-lg border-2 border-transparent bg-[var(--muted)] p-5 text-center transition-colors hover:border-[var(--primary)] hover:bg-[var(--muted)]/80"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900">
              <Mail className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="font-medium">E-mail Automático</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Sequência de emails com editor rich text
              </p>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
