import Image from 'next/image';
import Link from 'next/link';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
          <Link href="/login" className="flex items-center gap-2">
            <Image
              src="/logos/logo-ea-red.png"
              alt="Enriquece AI"
              width={32}
              height={32}
              className="rounded-full"
              unoptimized
            />
            <span className="text-lg font-bold">Enriquece AI</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-10">{children}</main>
      <footer className="border-t border-[var(--border)] py-6 text-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        <div className="mx-auto flex max-w-4xl items-center justify-center gap-4 px-6">
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
