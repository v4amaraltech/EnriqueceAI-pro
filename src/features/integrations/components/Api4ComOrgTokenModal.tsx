'use client';

import { useState, useTransition } from 'react';
import { Eye, EyeOff } from 'lucide-react';
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

import { saveApi4ComOrgSettings } from '../actions/manage-api4com-org';
import type { Api4ComSyncReport } from '../types';

const DEFAULT_BASE_URL = 'https://api.api4com.com/api/v1/';

interface Api4ComOrgTokenModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultBaseUrl?: string | null;
  hasExistingToken: boolean;
  onSaved: (report: Api4ComSyncReport) => void;
}

export function Api4ComOrgTokenModal({
  open,
  onOpenChange,
  defaultBaseUrl,
  hasExistingToken,
  onSaved,
}: Api4ComOrgTokenModalProps) {
  const [isPending, startTransition] = useTransition();
  const [apiToken, setApiToken] = useState('');
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl || DEFAULT_BASE_URL);
  const [showToken, setShowToken] = useState(false);

  function handleSave() {
    if (!apiToken.trim()) {
      toast.error('Informe o token da API4COM');
      return;
    }
    startTransition(async () => {
      const result = await saveApi4ComOrgSettings({ apiToken: apiToken.trim(), baseUrl: baseUrl || undefined });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setApiToken('');
      onSaved(result.data);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Token da conta API4COM</DialogTitle>
          <DialogDescription>
            Um token só para a organização inteira. No painel da API4COM, crie um token de acesso
            que não expira (validade &quot;nunca&quot;). Ao salvar, os ramais do time são sincronizados
            pelo e-mail de cada pessoa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api4com-org-token">
              Token{' '}
              {hasExistingToken && (
                <span className="font-normal text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  (substitui o atual)
                </span>
              )}
            </Label>
            <div className="relative">
              <Input
                id="api4com-org-token"
                type={showToken ? 'text' : 'password'}
                autoComplete="off"
                placeholder={hasExistingToken ? '••••••••••••••' : 'Cole o token aqui'}
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                aria-label={showToken ? 'Ocultar token' : 'Mostrar token'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-[var(--foreground)]"
                onClick={() => setShowToken((v) => !v)}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="api4com-org-base-url">API Base URL</Label>
            <Input
              id="api4com-org-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={DEFAULT_BASE_URL}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? 'Validando e sincronizando…' : 'Salvar e sincronizar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
