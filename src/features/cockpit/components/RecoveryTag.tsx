import { Badge } from '@/shared/components/ui/badge';

/** Texto da etiqueta: "Recuperação · Perdido: <motivo>" (sem motivo: "Recuperação · Perdido"). */
export function recoveryTagText(reason: string | null | undefined): string {
  const name = reason?.trim();
  return name ? `Recuperação · Perdido: ${name}` : 'Recuperação · Perdido';
}

/** A etiqueta só existe na fila de Recuperação ou para lead perdido (`unqualified`). */
export function showsRecoveryTag(input: { queue: string; status: string }): boolean {
  return input.queue === 'recovery' || input.status === 'unqualified';
}

/** Etiqueta discreta (borda âmbar, texto legível no tema claro e escuro). Quebra a linha em vez de estourar a largura. */
export function RecoveryTag({ reason }: { reason: string | null | undefined }) {
  return (
    <Badge
      variant="outline"
      className="h-auto max-w-full whitespace-normal border-amber-500/70 text-amber-700 dark:text-amber-300"
      data-testid="recovery-tag"
    >
      {recoveryTagText(reason)}
    </Badge>
  );
}
