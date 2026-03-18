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

import { connectRdStationCrm } from '../actions/manage-crm';

interface RdStationTokenModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function RdStationTokenModal({
  open,
  onOpenChange,
  onSuccess,
}: RdStationTokenModalProps) {
  const [isPending, startTransition] = useTransition();
  const [apiToken, setApiToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  function handleSave() {
    if (!apiToken.trim()) {
      toast.error('Token de API é obrigatório');
      return;
    }

    startTransition(async () => {
      const result = await connectRdStationCrm(apiToken);

      if (result.success) {
        toast.success('RD Station CRM conectado com sucesso');
        setApiToken('');
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
            src="/logos/rdstation-icon.png"
            alt="RD Station CRM"
            width={56}
            height={56}
            className="mb-2 rounded-lg"
          />
          <DialogTitle className="text-xl">Conectar RD Station CRM</DialogTitle>
          <DialogDescription>
            Cole seu Token de API do RD Station CRM para sincronizar leads e negócios
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <div className="rounded-lg bg-[var(--muted)] p-4">
            <p className="mb-2 text-sm font-semibold text-purple-600 dark:text-purple-400">Como obter seu Token:</p>
            <ul className="space-y-1 text-sm text-purple-600/80 dark:text-purple-400/80">
              <li>1. Acesse app.rdstation.com/crm → Configurações</li>
              <li>2. Vá em &quot;Integrações&quot; → &quot;Token da API&quot;</li>
              <li>3. Copie o token gerado</li>
            </ul>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rd-api-token" className="font-semibold">
              Token de API
            </Label>
            <div className="relative">
              <Input
                id="rd-api-token"
                type={showToken ? 'text' : 'password'}
                placeholder="Cole seu Token de API aqui"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              O token será encriptado e armazenado de forma segura
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={handleSave} disabled={isPending} className="w-full">
            {isPending ? 'Conectando...' : 'Conectar RD Station'}
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
