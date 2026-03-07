import { Search } from 'lucide-react';

export function ApolloEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <div className="rounded-full bg-[var(--muted)] p-4">
        <Search className="h-8 w-8 text-[var(--muted-foreground)]" />
      </div>
      <h3 className="text-lg font-medium">Buscar pessoas no Apollo</h3>
      <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
        Configure os filtros na barra lateral e clique em Buscar para encontrar leads.
      </p>
    </div>
  );
}
