import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/utils';

import { buttonVariants } from './button';

describe('button contrast in dark mode', () => {
  it('draws the outline button with the border token and a solid focus outline', () => {
    const outline = cn(buttonVariants({ variant: 'outline' }));
    expect(outline).toContain('text-foreground');
    expect(outline).toContain('border-border');
    expect(outline).toContain('bg-background');
    expect(outline).toContain('focus-visible:outline-2');
    expect(outline).toContain('focus-visible:outline-solid');
    expect(outline).toContain('focus-visible:outline-ring');
    expect(outline).toContain('hover:bg-accent');
    expect(outline).toContain('disabled:opacity-60');
    expect(outline).not.toContain('dark:border-input');
    expect(outline).not.toContain('dark:bg-input/30');
    expect(outline).not.toContain('dark:border-foreground/50');
  });

  it('paints ghost labels with the theme color instead of the browser default', () => {
    const ghost = cn(buttonVariants({ variant: 'ghost' }));
    expect(ghost).toContain('text-foreground');
    expect(ghost).not.toContain('border-border');
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

  it('leaves secondary as a fill, without a new border', () => {
    const secondary = cn(buttonVariants({ variant: 'secondary' }));
    expect(secondary).toContain('text-secondary-foreground');
    expect(secondary).not.toContain('text-foreground');
    expect(secondary).not.toContain('border-border');
  });
});
