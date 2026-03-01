'use client';

import { useActionState } from 'react';

import { Copy } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import { inviteMember } from '../actions/invite-member';

type FormState = {
  error?: string;
  success?: boolean;
  code?: string;
  tempPassword?: string | null;
};

export function InviteMemberDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      const result = await inviteMember(formData);
      if (result.success) {
        return { success: true, tempPassword: result.data.tempPassword };
      }
      return { error: result.error, code: result.code };
    },
    {} as FormState,
  );

  const isLimitReached = state.code === 'MEMBER_LIMIT_REACHED';

  function copyPassword() {
    if (state.tempPassword) {
      navigator.clipboard.writeText(state.tempPassword);
      toast.success('Senha copiada!');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar membro</DialogTitle>
          <DialogDescription>Adicione um novo membro à sua organização.</DialogDescription>
        </DialogHeader>

        {state.success && (
          <div className="space-y-3 rounded-md border border-green-600/30 bg-green-600/10 p-4">
            <p className="text-sm font-medium text-green-500">Membro adicionado com sucesso!</p>
            {state.tempPassword ? (
              <div className="space-y-2 rounded-md border border-border bg-muted p-3">
                <p className="text-sm text-muted-foreground">Senha temporária:</p>
                <div className="flex items-center gap-2">
                  <code className="text-lg font-bold text-foreground">{state.tempPassword}</code>
                  <Button type="button" variant="ghost" size="sm" onClick={copyPassword}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Compartilhe esta senha com o membro. Ele deve acessar{' '}
                  <strong>{window.location.origin}/login</strong> com o email e esta senha.
                </p>
              </div>
            ) : (
              <p className="text-sm text-green-500">
                O usuário já possui conta e foi adicionado à organização. Ele pode acessar com suas
                credenciais existentes.
              </p>
            )}
          </div>
        )}

        {isLimitReached && (
          <div className="space-y-3 rounded-md bg-yellow-50 p-4">
            <p className="text-sm text-yellow-800">{state.error}</p>
            <Button variant="outline" size="sm" asChild>
              <a href="/settings/billing">Ver planos</a>
            </Button>
          </div>
        )}

        {!state.success && (
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                placeholder="membro@empresa.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                name="role"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                defaultValue="sdr"
              >
                <option value="sdr">SDR (Vendedor)</option>
                <option value="manager">Manager (Gerente)</option>
              </select>
            </div>

            {state.error && !isLimitReached && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Adicionando...' : 'Adicionar membro'}
              </Button>
            </div>
          </form>
        )}

        {state.success && (
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
