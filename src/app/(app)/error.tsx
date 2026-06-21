'use client';

import { useEffect, useState, useTransition } from 'react';

import * as Sentry from '@sentry/nextjs';
import { AlertTriangle } from 'lucide-react';

// Errors that mean "the client is running an older build than the server" —
// all recover with a single reload to pull the new build. Besides chunk loads,
// this covers stale Server Action references after a deploy: action IDs are
// content-hashed and change per build, so an open tab calling an old action ID
// gets "Server Action ... was not found" / UnrecognizedActionError.
const STALE_DEPLOY_ERROR_PATTERN = /Loading chunk|Failed to load external script|ChunkLoadError|Loading CSS chunk|Server Action .*was not found|UnrecognizedActionError|failed to find server action/i;
const RELOAD_FLAG_KEY = 'chunk-reload-attempted';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [isReloading, setIsReloading] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const isStaleDeploy = STALE_DEPLOY_ERROR_PATTERN.test(error.message) || error.name === 'UnrecognizedActionError';
    if (isStaleDeploy && typeof window !== 'undefined' && !sessionStorage.getItem(RELOAD_FLAG_KEY)) {
      // Client is on an older build than the server (stale chunk or stale
      // Server Action ID after a deploy). Auto-recover once per session — the
      // flag prevents a reload loop if the second attempt still fails (network
      // down, CDN failing, etc).
      sessionStorage.setItem(RELOAD_FLAG_KEY, '1');
      startTransition(() => setIsReloading(true));
      const id = window.setTimeout(() => window.location.reload(), 1200);
      return () => window.clearTimeout(id);
    }
    Sentry.captureException(error);
    return undefined;
  }, [error, startTransition]);

  if (isReloading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md rounded-lg border bg-[var(--card)] p-8 text-center shadow-sm">
          <h2 className="text-lg font-semibold">Nova versão disponível</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Recarregando para aplicar a atualização...
          </p>
        </div>
      </div>
    );
  }

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
