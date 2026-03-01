'use client';

import { useState, useTransition } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import Image from 'next/image';
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

import { saveThreeCPlusConfig } from '../actions/manage-threecplus';

interface ThreeCPlusConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  defaultExtension?: string;
  defaultBaseUrl?: string;
  hasExistingApiToken?: boolean;
}

const DEFAULT_BASE_URL = 'https://app.3c.plus/api/v1';

export function ThreeCPlusConfigModal({
  open,
  onOpenChange,
  onSuccess,
  defaultExtension = '',
  defaultBaseUrl = DEFAULT_BASE_URL,
  hasExistingApiToken = false,
}: ThreeCPlusConfigModalProps) {
  const [isPending, startTransition] = useTransition();
  const [extension, setExtension] = useState(defaultExtension);
  const [apiToken, setApiToken] = useState('');
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl || DEFAULT_BASE_URL);
  const [showToken, setShowToken] = useState(false);

  function handleSave() {
    if (!extension.trim()) {
      toast.error('Extensão/Ramal é obrigatório');
      return;
    }

    startTransition(async () => {
      const result = await saveThreeCPlusConfig({
        extension: extension.trim(),
        apiToken: apiToken || undefined,
        baseUrl: baseUrl || undefined,
      });

      if (result.success) {
        toast.success('Configurações salvas com sucesso');
        onSuccess();
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="items-center text-center">
          <Image
            src="/logos/3cplus-logo.png"
            alt="3CPlus"
            width={40}
            height={40}
            className="rounded-lg"
          />
          <DialogTitle className="text-lg">Configurações 3CPlus</DialogTitle>
          <DialogDescription className="text-xs">
            Configure as credenciais e a extensão para realizar chamadas via 3CPlus
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Prerequisites */}
          <details className="rounded-lg bg-[var(--muted)] p-3 text-sm">
            <summary className="cursor-pointer font-semibold text-orange-500">Pré-requisitos</summary>
            <ul className="mt-2 space-y-0.5 text-xs text-orange-500/80">
              <li>• Conta ativa na plataforma 3CPlus</li>
              <li>• Extensão/ramal configurado e vinculado ao seu usuário</li>
              <li>• Token de API gerado no painel administrativo</li>
            </ul>
          </details>

          {/* Extension */}
          <div className="space-y-1.5">
            <Label htmlFor="extension" className="text-sm font-semibold">
              Extensão / Ramal (Obrigatório)
            </Label>
            <Input
              id="extension"
              placeholder="1001"
              value={extension}
              onChange={(e) => setExtension(e.target.value)}
            />
          </div>

          <div className="border-t border-[var(--border)]" />

          {/* Account config section */}
          <div className="space-y-3">
            <p className="text-sm font-semibold">Configurações da Conta (Opcional)</p>

            {/* API Token */}
            <div className="space-y-1.5">
              <Label htmlFor="api-token-3cp" className="text-sm">
                API Token{' '}
                {hasExistingApiToken && (
                  <span className="font-normal text-[var(--muted-foreground)]">
                    (deixe vazio para manter o atual)
                  </span>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="api-token-3cp"
                  type={showToken ? 'text' : 'password'}
                  placeholder={hasExistingApiToken ? '••••••••••••••' : 'Cole seu token aqui'}
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
            </div>

            {/* Base URL */}
            <div className="space-y-1.5">
              <Label htmlFor="base-url-3cp" className="text-sm">API Base URL</Label>
              <Input
                id="base-url-3cp"
                placeholder={DEFAULT_BASE_URL}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              <p className="text-xs text-[var(--muted-foreground)]">
                Padrão: {DEFAULT_BASE_URL}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isPending} className="flex-1">
            {isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
