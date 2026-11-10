import type { ReactNode } from 'react';

export function PublicCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-[var(--background)]">
      <div className="w-full max-w-lg">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-[var(--border)] dark:bg-[var(--card)]">
          <div className="bg-primary px-8 py-6">
            <h1 className="text-xl font-semibold text-white">EnriqueceAI</h1>
            <p className="mt-1 text-sm text-gray-300">{title}</p>
          </div>
          <div className="space-y-4 p-8 text-sm text-gray-600 dark:text-[var(--muted-foreground)]">{children}</div>
        </div>
      </div>
    </div>
  );
}
