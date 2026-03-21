'use client';

import { PlayCircle } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

const quotes = [
  { text: 'Acredite em milagres, mas não dependa deles.', author: 'Immanuel Kant' },
  { text: 'A persistência é o caminho do êxito.', author: 'Charles Chaplin' },
  { text: 'Grandes resultados requerem grandes ambições.', author: 'Heráclito' },
  { text: 'O sucesso nasce do querer, da determinação e persistência.', author: 'José de Alencar' },
  { text: 'Não espere por uma crise para descobrir o que é importante.', author: 'John F. Kennedy' },
];

function getDailyQuote() {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000,
  );
  return quotes[dayOfYear % quotes.length]!;
}

interface ActivityEmptyStateProps {
  onStartActivities?: () => void;
}

export function ActivityEmptyState({ onStartActivities }: ActivityEmptyStateProps) {
  const quote = getDailyQuote();

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="max-w-lg text-2xl font-light text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        {quote.text}
      </p>
      <p className="mt-3 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]/60">
        — {quote.author}
      </p>
      {onStartActivities && (
        <Button
          onClick={onStartActivities}
          size="lg"
          className="mt-10 gap-2 bg-emerald-600 px-6 text-white hover:bg-emerald-700"
        >
          Iniciar atividades
          <PlayCircle className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
