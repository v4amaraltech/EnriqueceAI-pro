import Image from 'next/image';
import Link from 'next/link';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-3">
          <Link href="/docs/api" className="flex items-center gap-2">
            <Image
              src="/logos/logo-ea-red.png"
              alt="Enriquece AI"
              width={32}
              height={32}
              className="rounded-full"
              unoptimized
            />
            <span className="text-lg font-bold">
              Enriquece AI <span className="text-[var(--muted-foreground)]">Developers</span>
            </span>
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--muted)]"
          >
            Acessar plataforma
          </Link>
        </div>
      </header>
      {children}
      <footer className="border-t border-[var(--border)] py-6 text-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-4 px-6">
          <Link href="/privacy" className="hover:underline">
            Privacidade
          </Link>
          <span>|</span>
          <Link href="/terms" className="hover:underline">
            Termos de Uso
          </Link>
        </div>
      </footer>
    </div>
  );
}
