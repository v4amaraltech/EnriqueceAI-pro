import { GitBranch } from 'lucide-react';

export default function ProspectingCadencesPage() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <GitBranch className="mb-4 h-12 w-12 text-[var(--muted-foreground)] opacity-40" />
      <h1 className="text-2xl font-bold">Cadências</h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        Estatísticas detalhadas de cadências estarão disponíveis em breve.
      </p>
    </div>
  );
}
