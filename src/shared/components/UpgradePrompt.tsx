import Link from 'next/link';
import { Lock } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

interface UpgradePromptProps {
  featureName: string;
  requiredPlan: string;
  description?: string;
}

export function UpgradePrompt({ featureName, requiredPlan, description }: UpgradePromptProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 rounded-full bg-[var(--muted)] p-4">
        <Lock className="h-10 w-10 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
      </div>
      <h3 className="mb-2 text-lg font-semibold">{featureName}</h3>
      <p className="mb-6 max-w-sm text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        {description ?? `Disponível a partir do plano ${requiredPlan}. Faça upgrade para desbloquear esta funcionalidade.`}
      </p>
      <Button asChild>
        <Link href="/settings/billing">Fazer upgrade</Link>
      </Button>
    </div>
  );
}
