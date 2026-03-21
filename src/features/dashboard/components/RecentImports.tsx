'use client';

import Link from 'next/link';
import { FileUp } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';

import type { ImportSummary } from '../dashboard.contract';

interface RecentImportsProps {
  imports: ImportSummary[];
}

export function RecentImports({ imports }: RecentImportsProps) {
  if (imports.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importações Recentes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Nenhuma importação realizada ainda.{' '}
            <Link href="/leads/import" className="text-[var(--primary)] hover:underline">
              Importar CSV
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Importações Recentes</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {imports.map((imp) => {
            const successRate = imp.total_rows > 0
              ? Math.round((imp.success_count / imp.total_rows) * 100)
              : 0;

            return (
              <div key={imp.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <FileUp className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                  <div>
                    <p className="font-medium">{imp.file_name}</p>
                    <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                      {new Date(imp.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                    {imp.success_count}/{imp.total_rows}
                  </span>
                  <Badge
                    variant="outline"
                    className={
                      successRate >= 80
                        ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                        : successRate >= 50
                          ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                    }
                  >
                    {successRate}%
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
