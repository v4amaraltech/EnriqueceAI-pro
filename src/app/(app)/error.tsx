'use client';

import { useEffect } from 'react';

import * as Sentry from '@sentry/nextjs';
import { AlertTriangle } from 'lucide-react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md rounded-lg border bg-[var(--card)] p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto h-10 w-10 text-[var(--destructive)]" />
        <h2 className="mt-4 text-lg font-semibold">Erro ao carregar página</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Ocorreu um erro ao carregar esta seção. Seus dados estão seguros.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Referência: {error.digest}
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex items-center rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
        >
          Tentar novamente
        </button>
      </div>
    </div>
  );
}
