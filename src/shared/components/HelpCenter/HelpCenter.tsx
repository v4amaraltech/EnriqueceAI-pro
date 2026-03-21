'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { driver } from 'driver.js';
import { ExternalLink, HelpCircle, Lightbulb, Map, Rocket } from 'lucide-react';

import 'driver.js/dist/driver.css';

import { Button } from '@/shared/components/ui/button';
import { Separator } from '@/shared/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';

import { getTipsForRoute, quickStarts } from './help-content';
import { appTourSteps } from './tour-steps';

export function HelpCenter() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const tips = getTipsForRoute(pathname);

  const startTour = useCallback(() => {
    setOpen(false);
    // Small delay to let the Sheet close before starting the tour
    setTimeout(() => {
      const tourDriver = driver({
        showProgress: true,
        steps: appTourSteps,
        nextBtnText: 'Próximo',
        prevBtnText: 'Anterior',
        doneBtnText: 'Concluir',
        progressText: '{{current}} de {{total}}',
      });
      tourDriver.drive();
    }, 300);
  }, []);

  return (
    <>
      <Button variant="ghost" size="icon" aria-label="Ajuda" onClick={() => setOpen(true)}>
        <HelpCircle className="h-4 w-4" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex flex-col gap-0 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Central de Ajuda</SheetTitle>
            <SheetDescription>Dicas, atalhos e tour pela plataforma</SheetDescription>
          </SheetHeader>

          {/* Tour Button */}
          <div className="px-4 pt-4">
            <Button onClick={startTour} className="w-full gap-2" variant="outline">
              <Map className="h-4 w-4" />
              Iniciar Tour pela Plataforma
            </Button>
          </div>

          <Separator className="mt-4" />

          {/* Contextual Tips */}
          <div className="space-y-3 px-4 py-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold">
              <Lightbulb className="h-4 w-4 text-yellow-500" />
              Dicas para esta pagina
            </h4>
            <div className="space-y-2">
              {tips.map((tip) => (
                <div
                  key={tip.title}
                  className="rounded-md border bg-[var(--muted)] p-3"
                >
                  <p className="text-sm font-medium">{tip.title}</p>
                  <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{tip.description}</p>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Quick Starts */}
          <div className="space-y-3 px-4 py-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold">
              <Rocket className="h-4 w-4 text-blue-500" />
              Inicio rapido
            </h4>
            <div className="space-y-1">
              {quickStarts.map((qs) => (
                <Link
                  key={qs.href}
                  href={qs.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-[var(--accent)]"
                >
                  <qs.icon className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                  <div>
                    <p className="text-sm font-medium">{qs.label}</p>
                    <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{qs.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <Separator />

          {/* Footer */}
          <div className="mt-auto px-4 py-4">
            <p className="mb-2 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Precisa de mais ajuda?</p>
            <a
              href="mailto:suporte@enriqueceai.com"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--primary)] hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Fale com o suporte
            </a>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
