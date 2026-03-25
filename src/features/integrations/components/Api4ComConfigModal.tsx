'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
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

import { saveApi4ComConfig } from '../actions/manage-api4com';

interface Api4ComConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  defaultRamal?: string;
  defaultBaseUrl?: string;
  hasExistingApiKey?: boolean;
  defaultSipDomain?: string;
  hasExistingSipPassword?: boolean;
}

const DEFAULT_BASE_URL = 'https://api.api4com.com/api/v1/';

export function Api4ComConfigModal({
  open,
  onOpenChange,
  onSuccess,
  defaultRamal = '',
  defaultBaseUrl = DEFAULT_BASE_URL,
  hasExistingApiKey = false,
  defaultSipDomain = '',
  hasExistingSipPassword = false,
}: Api4ComConfigModalProps) {
  const [isPending, startTransition] = useTransition();
  const [ramal, setRamal] = useState(defaultRamal);
  const [apiToken, setApiToken] = useState('');
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl || DEFAULT_BASE_URL);
  const [sipDomain, setSipDomain] = useState(defaultSipDomain);
  const [sipPassword, setSipPassword] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [showSipPassword, setShowSipPassword] = useState(false);

  function handleSave() {
    if (!ramal.trim()) {
      toast.error('Ramal é obrigatório');
      return;
    }

    startTransition(async () => {
      const result = await saveApi4ComConfig({
        ramal: ramal.trim(),
        apiToken: apiToken || undefined,
        baseUrl: baseUrl || undefined,
        sipDomain: sipDomain || undefined,
        sipPassword: sipPassword || undefined,
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="items-center text-center">
          <Image
            src="/logos/api4com-logo.png"
            alt="API4Com"
            width={56}
            height={56}
            className="mb-2 rounded-lg"
          />
          <DialogTitle className="text-xl">Configurações API4Com</DialogTitle>
          <DialogDescription>
            Configure as credenciais e o seu ramal para realizar chamadas
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Prerequisites */}
          <div className="rounded-lg bg-[var(--muted)] p-4">
            <p className="mb-2 text-sm font-semibold text-orange-500">Pré-requisitos:</p>
            <ul className="space-y-1 text-sm text-orange-500/80">
              <li>• Conta ativa no painel da API4COM</li>
              <li>• Ramal cadastrado e vinculado ao seu usuário</li>
              <li>• Token de API gerado (Configurações → API)</li>
            </ul>
          </div>

          {/* Ramal */}
          <div className="space-y-2">
            <Label htmlFor="ramal" className="font-semibold">
              Ramal (Obrigatório)
            </Label>
            <Input
              id="ramal"
              placeholder="1014"
              value={ramal}
              onChange={(e) => setRamal(e.target.value)}
            />
            <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Número do seu ramal registrado no painel da API4COM
            </p>
          </div>

          <div className="border-t border-[var(--border)]" />

          {/* Account config section */}
          <div className="space-y-4">
            <p className="font-semibold">Configurações da Conta (Opcional)</p>

            {/* API Token */}
            <div className="space-y-2">
              <Label htmlFor="api-token">
                API Token{' '}
                {hasExistingApiKey && (
                  <span className="font-normal text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                    (deixe vazio para manter o atual)
                  </span>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="api-token"
                  type={showToken ? 'text' : 'password'}
                  placeholder={hasExistingApiKey ? '••••••••••••••' : 'Cole seu token aqui'}
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-[var(--foreground)]"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Base URL */}
            <div className="space-y-2">
              <Label htmlFor="base-url">API Base URL</Label>
              <Input
                id="base-url"
                placeholder={DEFAULT_BASE_URL}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                URL padrão: {DEFAULT_BASE_URL}
              </p>
            </div>
          </div>

          <div className="border-t border-[var(--border)]" />

          {/* Webphone SIP config */}
          <div className="space-y-4">
            <p className="font-semibold">Webphone SIP (Opcional)</p>

            {/* SIP Domain */}
            <div className="space-y-2">
              <Label htmlFor="sip-domain">Domínio SIP</Label>
              <Input
                id="sip-domain"
                placeholder="empresa.api4com.com"
                value={sipDomain}
                onChange={(e) => setSipDomain(e.target.value)}
              />
              <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Domínio da sua conta API4COM (ex: empresa.api4com.com)
              </p>
            </div>

            {/* SIP Password */}
            <div className="space-y-2">
              <Label htmlFor="sip-password">
                Senha do Ramal{' '}
                {hasExistingSipPassword && (
                  <span className="font-normal text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                    (deixe vazio para manter a atual)
                  </span>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="sip-password"
                  type={showSipPassword ? 'text' : 'password'}
                  placeholder={hasExistingSipPassword ? '••••••••••••••' : 'Senha do ramal SIP'}
                  value={sipPassword}
                  onChange={(e) => setSipPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-[var(--foreground)]"
                  onClick={() => setShowSipPassword(!showSipPassword)}
                >
                  {showSipPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Senha do ramal para conexão do webphone. Encontre no painel API4COM.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={handleSave} disabled={isPending} className="w-full">
            {isPending ? 'Salvando...' : 'Salvar Configurações'}
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
