'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';

import { ArrowLeft, Loader2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Progress } from '@/shared/components/ui/progress';

import { importLeads, type ImportLeadsResult } from '../actions/import-leads';
import type { CsvParseResult } from '../utils/csv-parser';
import { parseCsv } from '../utils/csv-parser';
import { CsvDropzone } from './CsvDropzone';
import { CsvPreview } from './CsvPreview';
import { ImportReport } from './ImportReport';

type ImportStep = 'upload' | 'preview' | 'importing' | 'report';

export function ImportView() {
  const [step, setStep] = useState<ImportStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<CsvParseResult | null>(null);
  const [importResult, setImportResult] = useState<ImportLeadsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);

    const content = await selectedFile.text();
    const result = parseCsv(content);

    // Check for file-level errors
    if (result.rows.length === 0 && result.errors.length > 0 && result.errors[0]?.rowNumber === 0) {
      setError(result.errors[0].errorMessage);
      return;
    }

    setParseResult(result);
    setStep('preview');
  }, []);

  const handleImport = useCallback(async () => {
    if (!file) return;

    setStep('importing');
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    const result = await importLeads(formData);
    if (result.success) {
      setImportResult(result.data);
      setStep('report');
    } else {
      setError(result.error);
      setStep('preview');
    }
  }, [file]);

  const handleReset = useCallback(() => {
    setStep('upload');
    setFile(null);
    setParseResult(null);
    setImportResult(null);
    setError(null);
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/leads/imports">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Importar Leads</h1>
          <p className="text-muted-foreground">Importe leads em massa via arquivo CSV com CNPJs.</p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {step === 'upload' && <CsvDropzone onFileSelect={handleFileSelect} />}

      {step === 'preview' && parseResult && (
        <div className="space-y-4">
          <CsvPreview
            rows={parseResult.rows}
            errorCount={parseResult.errors.length}
            totalRows={parseResult.totalRows}
          />
          <div className="flex gap-3">
            <Button onClick={handleImport} disabled={parseResult.rows.length === 0}>
              Importar {parseResult.rows.length} leads
            </Button>
            <Button variant="outline" onClick={handleReset}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="flex flex-col items-center gap-4 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Importando leads...</p>
          <Progress value={undefined} className="w-64" />
        </div>
      )}

      {step === 'report' && importResult && (
        <ImportReport result={importResult} onReset={handleReset} />
      )}
    </div>
  );
}
