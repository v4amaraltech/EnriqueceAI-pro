'use client';

import { useTransition } from 'react';
import { Check, Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';

import { getGmailAuthUrl } from '@/features/integrations/actions/manage-gmail';

interface OnboardingGmailStepProps {
  gmailConnected: boolean;
  onNext: () => void;
  onBack: () => void;
}

export function OnboardingGmailStep({ gmailConnected, onNext, onBack }: OnboardingGmailStepProps) {
  const [isPending, startTransition] = useTransition();

  function handleConnect() {
    startTransition(async () => {
      const result = await getGmailAuthUrl('/onboarding?step=3&gmail=connected');
      if (result.success) {
        window.location.href = result.data.url;
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <Mail className="mx-auto h-10 w-10 text-[var(--primary)]" />
        <h1 className="mt-4 text-2xl font-bold">Conecte seu Gmail</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Conecte seu Gmail para enviar emails diretamente pela plataforma.
        </p>
      </div>

      {gmailConnected ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-green-300/50 bg-green-50 p-4 dark:border-green-700/50 dark:bg-green-900/20">
          <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
          <span className="text-sm font-medium text-green-800 dark:text-green-200">
            Gmail conectado com sucesso!
          </span>
        </div>
      ) : (
        <Button onClick={handleConnect} disabled={isPending} variant="outline" className="w-full">
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Mail className="mr-2 h-4 w-4" />
          )}
          Conectar Gmail
        </Button>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          Voltar
        </Button>
        <Button onClick={onNext} className="flex-1">
          {gmailConnected ? 'Continuar' : 'Pular por agora'}
        </Button>
      </div>
    </div>
  );
}
