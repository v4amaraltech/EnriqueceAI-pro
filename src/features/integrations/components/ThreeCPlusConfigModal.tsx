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

import { saveThreeCPlusConfig } from '../actions/manage-threecplus';

interface ThreeCPlusConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  defaultLogin?: string;
  defaultDomain?: string;
}

export function ThreeCPlusConfigModal({
  open,
  onOpenChange,
  onSuccess,
  defaultLogin = '',
  defaultDomain = '',
}: ThreeCPlusConfigModalProps) {
  const [isPending, startTransition] = useTransition();
  const [login, setLogin] = useState(defaultLogin);
  const [password, setPassword] = useState('');
  const [domain, setDomain] = useState(defaultDomain);
  const [showPassword, setShowPassword] = useState(false);

  function handleSave() {
    if (!login.trim()) {
      toast.error('Login é obrigatório');
      return;
    }
    if (!password.trim()) {
      toast.error('Senha é obrigatória');
      return;
    }
    if (!domain.trim()) {
      toast.error('Domínio é obrigatório');
      return;
    }

    startTransition(async () => {
      const result = await saveThreeCPlusConfig({
        login: login.trim(),
        password: password.trim(),
        domain: domain.trim(),
      });

      if (result.success) {
        toast.success('3CPlus conectado com sucesso');
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
            src="/logos/3cplus-logo.png"
            alt="3CPlus"
            width={56}
            height={56}
            className="mb-2 rounded-lg"
          />
          <DialogTitle className="text-xl">Configurar 3CPlus</DialogTitle>
          <DialogDescription>
            Conecte seu discador 3CPlus para realizar chamadas pela plataforma
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Prerequisites */}
          <div className="rounded-lg bg-[var(--muted)] p-4">
            <p className="mb-2 text-sm font-semibold text-orange-500">Pré-requisitos:</p>
            <ul className="space-y-1 text-sm text-orange-500/80">
              <li>• Conta ativa no painel 3CPlus</li>
              <li>• Usuário do tipo Agente cadastrado</li>
              <li>• Pelo menos uma campanha ativa</li>
            </ul>
          </div>

          {/* Domain */}
          <div className="space-y-2">
            <Label htmlFor="threecplus-domain" className="font-semibold">
              Domínio (Obrigatório)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="threecplus-domain"
                placeholder="minhaempresa"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
              <span className="shrink-0 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                .3c.fluxcloud.com.br
              </span>
            </div>
            <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              O subdomínio da sua empresa no painel 3CPlus
            </p>
          </div>

          <div className="border-t border-[var(--border)]" />

          {/* Credentials */}
          <div className="space-y-4">
            <p className="font-semibold">Credenciais do Agente</p>

            {/* Login */}
            <div className="space-y-2">
              <Label htmlFor="threecplus-login">Login</Label>
              <Input
                id="threecplus-login"
                placeholder="Seu login de agente"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="threecplus-password">Senha</Label>
              <div className="relative">
                <Input
                  id="threecplus-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Sua senha de agente"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-[var(--foreground)]"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                A senha é usada apenas para autenticação. O token gerado é armazenado de forma criptografada.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={handleSave} disabled={isPending} className="w-full">
            {isPending ? 'Conectando...' : 'Conectar'}
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
