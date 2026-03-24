import Link from 'next/link';

import { ThemeProvider } from 'next-themes';

import { requireAdmin } from '@/lib/auth/require-admin';

import { Toaster } from '@/shared/components/ui/sonner';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <span className="text-sm font-semibold tracking-tight">Enriquece AI — Admin</span>
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            ← Voltar ao app
          </Link>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
      <Toaster />
    </ThemeProvider>
  );
}
