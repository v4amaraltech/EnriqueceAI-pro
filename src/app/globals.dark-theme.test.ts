import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(selector);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function value(source: string, name: string): string {
  const match = source.match(new RegExp(`${name}:\\s*([^;]+);`));
  return match?.[1]?.trim() ?? '';
}

describe('tokens do tema escuro', () => {
  const dark = block('.dark {');
  const root = block(':root {');

  it('sobe borda, campo e vermelho só no escuro, acima de 3:1', () => {
    expect(value(dark, '--border')).toBe('oklch(0.52 0 0)');
    expect(value(dark, '--input')).toBe('oklch(0.52 0 0)');
    expect(value(dark, '--sidebar-border')).toBe('oklch(0.50 0 0)');
    expect(value(dark, '--primary')).toBe('oklch(0.55 0.20 27)');
    expect(value(dark, '--ring')).toBe('oklch(0.55 0.20 27)');
    expect(value(dark, '--sidebar-primary')).toBe('oklch(0.55 0.20 27)');
    expect(value(dark, '--sidebar-ring')).toBe('oklch(0.55 0.20 27)');
    expect(value(dark, '--background')).toBe('oklch(0.10 0 0)');
    expect(value(dark, '--card')).toBe('oklch(0.15 0 0)');
    expect(value(dark, '--muted')).toBe('oklch(0.18 0 0)');
    expect(value(dark, '--accent')).toBe('oklch(0.25 0 0)');
  });

  it('não altera o tema claro', () => {
    expect(value(root, '--primary')).toBe('oklch(0.56 0.22 27)');
    expect(value(root, '--border')).toBe('oklch(0.91 0 0)');
    expect(value(root, '--input')).toBe('oklch(0.91 0 0)');
    expect(value(root, '--sidebar-border')).toBe('oklch(0.22 0 0)');
    expect(value(root, '--sidebar-primary')).toBe('oklch(0.56 0.22 27)');
    expect(value(root, '--ring')).toBe('oklch(0.56 0.22 27)');
    expect(value(root, '--background')).toBe('oklch(1 0 0)');
  });
});
