'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';

import { ArrowLeft, CheckCircle, Download, Loader2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { Progress } from '@/shared/components/ui/progress';

import { searchApollo, type SearchApolloInput } from '../actions/search-apollo';
import { importApolloLeads, type ImportApolloResult } from '../actions/import-apollo-leads';
import type { ApolloSearchPerson } from '../services/apollo.service';
import { ApolloSearchForm } from './ApolloSearchForm';
import { ApolloResultsTable } from './ApolloResultsTable';
import { ApolloEmptyState } from './ApolloEmptyState';

type WizardStep = 'search' | 'importing' | 'report';

export function ApolloImportView() {
  const [step, setStep] = useState<WizardStep>('search');
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [people, setPeople] = useState<ApolloSearchPerson[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [lastSearchParams, setLastSearchParams] = useState<SearchApolloInput | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importResult, setImportResult] = useState<ImportApolloResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async (params: SearchApolloInput) => {
    setIsSearching(true);
    setError(null);

    const result = await searchApollo(params);
    setIsSearching(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setPeople(result.data.people);
    setTotalResults(result.data.total);
    setCurrentPage(result.data.page);
    setLastSearchParams(params);
    setSelectedIds(new Set());
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (!lastSearchParams) return;

    setIsLoadingMore(true);
    const nextPage = currentPage + 1;
    const result = await searchApollo({ ...lastSearchParams, page: nextPage });
    setIsLoadingMore(false);

    if (result.success) {
      setPeople((prev) => [...prev, ...result.data.people]);
      setCurrentPage(nextPage);
    }
  }, [lastSearchParams, currentPage]);

  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = people.every((p) => prev.has(p.id));
      if (allSelected) {
        return new Set();
      }
      return new Set(people.map((p) => p.id));
    });
  }, [people]);

  const handleImport = useCallback(async () => {
    if (selectedIds.size === 0) return;

    setStep('importing');
    setError(null);

    const selectedPeople = people
      .filter((p) => selectedIds.has(p.id))
      .map((p) => ({
        id: p.id,
        firstName: p.first_name,
        lastName: null,
        domain: null,
        linkedinUrl: null,
      }));

    const result = await importApolloLeads(selectedPeople);

    if (result.success) {
      setImportResult(result.data);
      setStep('report');
    } else {
      setError(result.error);
      setStep('search');
    }
  }, [selectedIds, people]);

  const handleNewImport = useCallback(() => {
    setStep('search');
    setPeople([]);
    setTotalResults(0);
    setSelectedIds(new Set());
    setError(null);
    setLastSearchParams(null);
  }, []);

  // Importing & Report steps use centered layout
  if (step === 'importing' || step === 'report') {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/leads/imports">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Importar do Apollo.io</h1>
            <p className="text-[var(--muted-foreground)]">
              Busque pessoas na base do Apollo e importe como leads.
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-2xl">
          {step === 'importing' && (
            <div className="flex flex-col items-center gap-4 py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-[var(--muted-foreground)]">
                Enriquecendo e importando {selectedIds.size} lead{selectedIds.size !== 1 ? 's' : ''}...
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Cada pessoa e enriquecida individualmente para obter email e telefone.
              </p>
              <Progress value={undefined} className="w-64" />
            </div>
          )}

          {step === 'report' && importResult && (
            <Card>
              <CardContent className="flex flex-col items-center gap-6 py-12">
                <CheckCircle className="h-12 w-12 text-green-500" />
                <h2 className="text-xl font-semibold">Importacao concluida</h2>

                <div className="grid grid-cols-3 gap-8 text-center">
                  <div>
                    <p className="text-3xl font-bold text-green-600">{importResult.imported}</p>
                    <p className="text-sm text-[var(--muted-foreground)]">Importados</p>
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-amber-600">{importResult.duplicates}</p>
                    <p className="text-sm text-[var(--muted-foreground)]">Duplicados</p>
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-red-600">{importResult.errors}</p>
                    <p className="text-sm text-[var(--muted-foreground)]">Erros</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button asChild>
                    <Link href="/leads">Ver Leads</Link>
                  </Button>
                  <Button variant="outline" onClick={handleNewImport}>
                    Nova importacao
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  // Search step: sidebar + content layout
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4">
        <Button asChild variant="ghost" size="icon">
          <Link href="/leads/imports">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Importar do Apollo.io</h1>
          <p className="text-[var(--muted-foreground)]">
            Busque pessoas na base do Apollo e importe como leads.
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Sidebar + Content */}
      <div className="flex min-h-0 flex-1 gap-0 rounded-lg border">
        {/* Sidebar */}
        <aside className="w-80 shrink-0 overflow-y-auto border-r p-4">
          <ApolloSearchForm onSearch={handleSearch} isLoading={isSearching} />
        </aside>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {people.length === 0 ? (
            <ApolloEmptyState />
          ) : (
            <div className="space-y-4">
              <ApolloResultsTable
                people={people}
                total={totalResults}
                selectedIds={selectedIds}
                onToggle={handleToggle}
                onToggleAll={handleToggleAll}
                onLoadMore={handleLoadMore}
                hasMore={people.length < totalResults}
                isLoadingMore={isLoadingMore}
              />

              {selectedIds.size > 0 && (
                <div className="sticky bottom-4 flex justify-center">
                  <Button onClick={handleImport} size="lg" className="shadow-lg">
                    <Download className="mr-2 h-4 w-4" />
                    Importar {selectedIds.size} lead{selectedIds.size !== 1 ? 's' : ''}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
