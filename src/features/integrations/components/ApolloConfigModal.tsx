'use client';

import Image from 'next/image';
import { useState, useTransition } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/components/ui/dialog';

import { saveApolloConnection } from '../actions/manage-apollo';

interface ApolloConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ApolloConfigModal({
  open,
  onOpenChange,
  onSuccess,
}: ApolloConfigModalProps) {
  const [isPending, startTransition] = useTransition();
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  function handleSave() {
    if (!apiKey.trim()) {
      toast.error('API Key é obrigatória');
      return;
    }

    startTransition(async () => {
      const result = await saveApolloConnection(apiKey);

      if (result.success) {
        toast.success('Apollo conectado com sucesso');
        setApiKey('');
        onSuccess();
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="items-center text-center">
          <Image
            src="/logos/apollo-logo.webp"
            alt="Apollo.io"
            width={56}
            height={56}
            className="mb-2 rounded-lg"
          />
          <DialogTitle className="text-xl">Conectar Apollo.io</DialogTitle>
          <DialogDescription>
            Cole sua API Key do Apollo para habilitar busca e importação de leads
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <div className="rounded-lg bg-[var(--muted)] p-4">
            <p className="mb-2 text-sm font-semibold text-orange-500">Como obter sua API Key:</p>
            <ul className="space-y-1 text-sm text-orange-500/80">
              <li>1. Acesse app.apollo.io → Settings → Integrations</li>
              <li>2. Clique em &quot;API Keys&quot;</li>
              <li>3. Copie ou crie uma nova API Key</li>
            </ul>
          </div>

          <div className="space-y-2">
            <Label htmlFor="apollo-api-key" className="font-semibold">
              API Key
            </Label>
            <div className="relative">
              <Input
                id="apollo-api-key"
                type={showKey ? 'text' : 'password'}
                placeholder="Cole sua API Key aqui"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-[var(--foreground)]"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              A chave será encriptada e armazenada de forma segura
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={handleSave} disabled={isPending} className="w-full">
            {isPending ? 'Salvando...' : 'Conectar Apollo'}
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="w-full"
          >
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
