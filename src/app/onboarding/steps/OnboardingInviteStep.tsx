'use client';

import { useState, useTransition } from 'react';
import { Loader2, Send, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';

import { inviteMember } from '@/features/auth/actions/invite-member';

interface OnboardingInviteStepProps {
  onNext: () => void;
  onBack: () => void;
}

interface SentInvite {
  email: string;
  role: string;
}

export function OnboardingInviteStep({ onNext, onBack }: OnboardingInviteStepProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('sdr');
  const [sentInvites, setSentInvites] = useState<SentInvite[]>([]);
  const [isPending, startTransition] = useTransition();

  function handleInvite() {
    if (!email.trim()) {
      toast.error('Informe o email');
      return;
    }

    const formData = new FormData();
    formData.set('email', email.trim());
    formData.set('role', role);

    startTransition(async () => {
      const result = await inviteMember(formData);
      if (result.success) {
        setSentInvites((prev) => [...prev, { email: result.data.email, role }]);
        setEmail('');
        toast.success(`Convite enviado para ${result.data.email}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <Users className="mx-auto h-10 w-10 text-[var(--primary)]" />
        <h1 className="mt-4 text-2xl font-bold">Convide sua equipe</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Adicione membros da equipe. Você pode fazer isso depois também.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="inviteEmail">Email</Label>
          <div className="flex gap-2">
            <Input
              id="inviteEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colega@empresa.com"
              onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
              className="flex-1"
            />
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sdr">SDR</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          variant="outline"
          onClick={handleInvite}
          disabled={isPending || !email.trim()}
          className="w-full"
        >
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Enviar convite
        </Button>
      </div>

      {sentInvites.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--muted-foreground)]">Convites enviados:</p>
          {sentInvites.map((inv) => (
            <div
              key={inv.email}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span>{inv.email}</span>
              <Badge variant="secondary">{inv.role.toUpperCase()}</Badge>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          Voltar
        </Button>
        <Button onClick={onNext} className="flex-1">
          {sentInvites.length > 0 ? 'Continuar' : 'Pular por agora'}
        </Button>
      </div>
    </div>
  );
}
