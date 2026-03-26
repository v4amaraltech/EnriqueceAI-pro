'use client';

import { useState, useTransition } from 'react';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import { createApiKeyAction } from '../actions/manage-api-keys';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function ApiKeyCreateDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    startTransition(async () => {
      const result = await createApiKeyAction({
        name,
        expires_at: expiresAt || undefined,
      });

      if (result.success) {
        setCreatedKey(result.data.key);
        toast.success('Chave de API criada');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleCopy() {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleClose() {
    setName('');
    setExpiresAt('');
    setCreatedKey(null);
    setCopied(false);
    onOpenChange(false);
    if (createdKey) {
      onCreated();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Criar Chave de API</DialogTitle>
          <DialogDescription>
            Crie uma chave para integrar plataformas externas com o EnriqueceAI.
          </DialogDescription>
        </DialogHeader>

        {!createdKey ? (
          <div className="space-y-4">
            <div>
              <Label htmlFor="key-name">Nome</Label>
              <Input
                id="key-name"
                placeholder="Ex: RD Station, Landing Page, Zapier"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isPending}
              />
            </div>

            <div>
              <Label htmlFor="key-expires">Data de expiração (opcional)</Label>
              <Input
                id="key-expires"
                type="date"
                value={expiresAt ? expiresAt.split('T')[0] : ''}
                onChange={(e) => setExpiresAt(e.target.value ? `${e.target.value}T23:59:59Z` : '')}
                disabled={isPending}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose} disabled={isPending}>
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={isPending || !name.trim()}>
                {isPending ? 'Criando...' : 'Criar Chave'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Esta chave não poderá ser exibida novamente. Copie e guarde em local seguro.</span>
            </div>

            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={createdKey}
                className="font-mono text-xs"
              />
              <Button variant="outline" size="icon" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>

            <DialogFooter>
              <Button onClick={handleClose}>Fechar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
