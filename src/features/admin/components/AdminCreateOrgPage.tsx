'use client';

import { useCallback, useState, useTransition } from 'react';

import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import { createOrgWithManager } from '../actions/create-org-with-manager';

function generatePassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

interface CreatedOrg {
  orgId: string;
  userId: string;
  orgName: string;
  managerEmail: string;
  tempPassword: string;
}

export function AdminCreateOrgPage() {
  const [orgName, setOrgName] = useState('');
  const [managerName, setManagerName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [tempPassword, setTempPassword] = useState(() => generatePassword());
  const [createdOrg, setCreatedOrg] = useState<CreatedOrg | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleGeneratePassword = useCallback(() => {
    setTempPassword(generatePassword());
  }, []);

  const handleCopy = useCallback(async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    startTransition(async () => {
      const result = await createOrgWithManager({
        orgName,
        managerName,
        managerEmail,
        tempPassword,
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setCreatedOrg({
        orgId: result.data.orgId,
        userId: result.data.userId,
        orgName,
        managerEmail,
        tempPassword,
      });

      toast.success('Organização criada com sucesso!');

      // Reset form
      setOrgName('');
      setManagerName('');
      setManagerEmail('');
      setTempPassword(generatePassword());
    });
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Criar Organização</h1>
        <p className="text-sm text-muted-foreground">
          Cria uma nova organização com manager e trial de 14 dias.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nova Organização</CardTitle>
          <CardDescription>Preencha os dados do cliente.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="orgName">Nome da Organização</Label>
              <Input
                id="orgName"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Ex: Empresa XPTO"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="managerName">Nome do Manager</Label>
              <Input
                id="managerName"
                value={managerName}
                onChange={(e) => setManagerName(e.target.value)}
                placeholder="Ex: João Silva"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="managerEmail">Email do Manager</Label>
              <Input
                id="managerEmail"
                type="email"
                value={managerEmail}
                onChange={(e) => setManagerEmail(e.target.value)}
                placeholder="joao@empresa.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tempPassword">Senha Temporária</Label>
              <div className="flex gap-2">
                <Input
                  id="tempPassword"
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                  required
                  minLength={8}
                />
                <Button type="button" variant="outline" size="sm" onClick={handleGeneratePassword}>
                  Gerar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy(tempPassword, 'Senha')}
                >
                  Copiar
                </Button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? 'Criando...' : 'Criar Organização'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {createdOrg && (
        <Card className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
          <CardHeader>
            <CardTitle className="text-green-700 dark:text-green-400">Organização Criada!</CardTitle>
            <CardDescription>Envie as credenciais abaixo para o cliente.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-background p-4 text-sm space-y-1">
              <p>
                <span className="font-medium">Organização:</span> {createdOrg.orgName}
              </p>
              <p>
                <span className="font-medium">Email:</span> {createdOrg.managerEmail}
              </p>
              <p>
                <span className="font-medium">Senha:</span> {createdOrg.tempPassword}
              </p>
              <p>
                <span className="font-medium">URL:</span>{' '}
                {typeof window !== 'undefined' ? window.location.origin : ''}/login
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() =>
                handleCopy(
                  `Organização: ${createdOrg.orgName}\nEmail: ${createdOrg.managerEmail}\nSenha: ${createdOrg.tempPassword}\nURL: ${window.location.origin}/login`,
                  'Credenciais',
                )
              }
            >
              Copiar Credenciais
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
