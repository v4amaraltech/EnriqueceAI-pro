import { toast } from 'sonner';

import { parseSkippedCadenceName } from './enroll-skip-format';

/** Separa os leads pulados por conflito (já em outra cadência) dos demais erros. */
export function summarizeEnrollErrors(errors: string[]): {
  skipped: number;
  firstCadence: string | null;
  others: string[];
} {
  let skipped = 0;
  let firstCadence: string | null = null;
  const others: string[] = [];
  for (const error of errors) {
    const name = parseSkippedCadenceName(error);
    if (name !== null) {
      skipped++;
      firstCadence ??= name;
    } else {
      others.push(error);
    }
  }
  return { skipped, firstCadence, others };
}

export function skippedMessage(skipped: number, cadenceName: string | null): string {
  const plural = skipped > 1;
  const where = cadenceName ? ` (${cadenceName})` : '';
  return `${skipped} lead${plural ? 's' : ''} pulado${plural ? 's' : ''}: já ${plural ? 'estão' : 'está'} em outra cadência${where}`;
}

/**
 * Avisa o que não foi inscrito. Pulados por conflito ganham texto próprio;
 * os outros erros mantêm o toast de antes.
 */
export function notifyEnrollErrors(enrolled: number, errors: string[], fallback: string): void {
  if (errors.length === 0) return;
  const { skipped, firstCadence, others } = summarizeEnrollErrors(errors);
  if (enrolled > 0) {
    if (skipped > 0) toast.warning(skippedMessage(skipped, firstCadence));
    if (others.length > 0) toast.warning(`${others.length} erro(s)`);
    return;
  }
  if (skipped > 0) {
    toast.error(skippedMessage(skipped, firstCadence));
    if (others.length > 0) toast.warning(`${others.length} erro(s)`);
    return;
  }
  toast.error(others[0] ?? fallback);
}
