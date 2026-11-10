import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/utils';

import { buttonVariants } from './button';

describe('button contrast in dark mode', () => {
  it('keeps the outline border visible when --input is nearly the page background', () => {
    const outline = cn(buttonVariants({ variant: 'outline' }));
    expect(outline).toContain('text-foreground');
    expect(outline).toContain('border-border');
    expect(outline).toContain('dark:border-foreground/50');
    expect(outline).toContain('focus-visible:outline-ring');
    expect(outline).toContain('dark:bg-foreground/5');
    expect(outline).toContain('hover:bg-accent');
    expect(outline).toContain('focus-visible:ring-ring/50');
    expect(outline).toContain('disabled:opacity-60');
    expect(outline).not.toContain('dark:border-foreground/35');
    expect(outline).not.toContain('dark:border-input');
    expect(outline).not.toContain('dark:bg-input/30');
  });

  it('paints ghost labels with the theme color instead of the browser default', () => {
    const ghost = cn(buttonVariants({ variant: 'ghost' }));
    expect(ghost).toContain('text-foreground');
    expect(ghost).not.toContain('dark:border-foreground/50');
    const danger = cn(buttonVariants({ variant: 'ghost', className: 'text-destructive hover:text-destructive' }));
    expect(danger).toContain('text-destructive');
    expect(danger).not.toContain('text-foreground');
  });

  it('keeps filled variants on their own label color', () => {
    expect(cn(buttonVariants({ variant: 'default' }))).toContain('text-primary-foreground');
    expect(cn(buttonVariants({ variant: 'default' }))).not.toContain('text-foreground');
    expect(cn(buttonVariants({ variant: 'destructive' }))).toContain('text-white');
    expect(cn(buttonVariants({ variant: 'link' }))).toContain('text-primary');
  });

  it('gives secondary a dark border so the fill does not disappear into the page', () => {
    const secondary = cn(buttonVariants({ variant: 'secondary' }));
    expect(secondary).toContain('text-secondary-foreground');
    expect(secondary).not.toContain('text-foreground');
    expect(secondary).toContain('dark:border-foreground/50');
    expect(secondary).toContain('border-transparent');
  });
});
