'use client';

import { useEffect } from 'react';

import * as Sentry from '@sentry/nextjs';

export default function Error({
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
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border bg-[var(--card)] p-8 text-center shadow-sm">
        <h2 className="text-xl font-semibold">Algo deu errado</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Ocorreu um erro inesperado. Tente novamente ou entre em contato com o suporte.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Erro: {error.digest}
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
