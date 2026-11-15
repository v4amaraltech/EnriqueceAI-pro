'use client';

import { useState } from 'react';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ChevronDown, Menu } from 'lucide-react';

import { cn } from '@/lib/utils';

import { Button } from '@/shared/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';

import type { NavSection } from './TopBar';
import { navSections, useIsManagerNav, visibleNavSections } from './TopBar';

function MobileNavSection({
  section,
  pathname,
  onNavigate,
}: {
  section: NavSection;
  pathname: string;
  onNavigate: () => void;
}) {
  const isChildActive = section.items?.some(
    (item) => item.href && (pathname === item.href || pathname.startsWith(item.href + '/')),
  );
  const [expanded, setExpanded] = useState(isChildActive ?? false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isChildActive
            ? 'text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        {section.label}
        <ChevronDown
          className={cn(
            'h-4 w-4 transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded && (
        <div className="ml-3 flex flex-col border-l pl-3">
          {section.items?.map((item) =>
            item.placeholder ? (
              <span
                key={item.label}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground"
              >
                {item.label} — {item.placeholder}
              </span>
            ) : (
              <Link
                key={item.label}
                href={item.href!}
                onClick={onNavigate}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  pathname === item.href
                    ? 'font-medium text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const isManager = useIsManagerNav();

  const handleNavigate = () => setOpen(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setOpen(true)}
        aria-label="Menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-left text-xl font-bold text-primary">
              <Image src="/logos/logo-ea-red.png" alt="Enriquece AI" width={32} height={32} className="rounded-full" unoptimized />
              Enriquece AI
            </SheetTitle>
            <SheetDescription className="sr-only">
              Menu de navegação principal
            </SheetDescription>
          </SheetHeader>

          <nav className="flex flex-col gap-1 p-2">
            {visibleNavSections(navSections, isManager).map((section) =>
              section.href ? (
                <Link
                  key={section.label}
                  href={section.href}
                  onClick={handleNavigate}
                  className={cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    pathname === section.href ||
                      pathname.startsWith(section.href + '/')
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {section.label}
                </Link>
              ) : (
                <MobileNavSection
                  key={section.label}
                  section={section}
                  pathname={pathname}
                  onNavigate={handleNavigate}
                />
              ),
            )}
          </nav>

        </SheetContent>
      </Sheet>
    </>
  );
}
