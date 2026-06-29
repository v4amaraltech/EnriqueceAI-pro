import { verifyUnsubscribeToken } from '@/lib/security/unsubscribe-token';

import { UnsubscribeForm } from './UnsubscribeForm';

// M9: public opt-out confirmation page (no session). The token is verified
// server-side to show the e-mail; the actual suppression happens when the visitor
// confirms (or via one-click POST to /api/unsubscribe by modern mail clients).
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const parsed = verifyUnsubscribeToken(token);

  if (!parsed) {
    return <Shell>Link inválido ou expirado.</Shell>;
  }

  return (
    <Shell title="Cancelar inscrição">
      <p className="text-gray-600 dark:text-[var(--muted-foreground)] mb-6">
        Você está prestes a cancelar o recebimento de e-mails enviados para{' '}
        <strong>{parsed.email}</strong>. Após confirmar, este endereço não receberá
        mais mensagens das nossas cadências.
      </p>
      <UnsubscribeForm token={token} email={parsed.email} />
      {/* TODO(jurídico): revisar o texto de consentimento/LGPD desta página. */}
    </Shell>
  );
}

function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[var(--background)] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="bg-white dark:bg-[var(--card)] rounded-xl shadow-sm border border-gray-200 dark:border-[var(--border)] overflow-hidden">
          <div className="bg-primary px-8 py-6">
            <h1 className="text-white text-xl font-semibold">EnriqueceAI</h1>
            {title ? <p className="text-gray-300 text-sm mt-1">{title}</p> : null}
          </div>
          <div className="p-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
