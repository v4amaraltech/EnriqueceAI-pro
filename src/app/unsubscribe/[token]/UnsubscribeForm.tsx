'use client';

import { useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import { unsubscribeByToken } from '@/features/cadences/actions/unsubscribe';

type Phase = 'idle' | 'loading' | 'done' | 'error';

export function UnsubscribeForm({ token, email }: { token: string; email: string }) {
  const [phase, setPhase] = useState<Phase>('idle');

  if (phase === 'done') {
    return (
      <p className="text-emerald-600 dark:text-emerald-400 font-medium">
        Pronto! O e-mail <strong>{email}</strong> não receberá mais mensagens das nossas cadências.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        disabled={phase === 'loading'}
        onClick={async () => {
          setPhase('loading');
          const result = await unsubscribeByToken(token);
          setPhase(result.ok ? 'done' : 'error');
        }}
      >
        {phase === 'loading' ? 'Processando…' : 'Confirmar cancelamento'}
      </Button>
      {phase === 'error' && (
        <p className="text-sm text-destructive">
          Não foi possível processar agora. Tente novamente em instantes.
        </p>
      )}
    </div>
  );
}
