import { Search, SearchX } from 'lucide-react';

interface ApolloEmptyStateProps {
  hasSearched?: boolean;
}

export function ApolloEmptyState({ hasSearched }: ApolloEmptyStateProps) {
  if (hasSearched) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <div className="rounded-full bg-amber-100 p-4 dark:bg-amber-900/30">
          <SearchX className="h-8 w-8 text-amber-600 dark:text-amber-400" />
        </div>
        <h3 className="text-lg font-medium">Nenhum resultado encontrado</h3>
        <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
          Tente ajustar os filtros ou usar termos mais abrangentes para encontrar mais pessoas.
        </p>
      </div>
    );
  }

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
