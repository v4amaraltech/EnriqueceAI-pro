import { Mail } from 'lucide-react';

export default function ProspectingEmailsPage() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Mail className="mb-4 h-12 w-12 text-[var(--muted-foreground)] opacity-40" />
      <h1 className="text-2xl font-bold">E-mails</h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        Estatísticas de envio, abertura e cliques de e-mails estarão disponíveis em breve.
      </p>
    </div>
  );
}
