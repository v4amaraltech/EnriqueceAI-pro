import { CallbackContactNotice } from '@/features/cockpit/components/CallbackContactNotice';
import type { CallbackTarget } from '@/features/cockpit/services/callback-contact.service';

/** "Retorno com {nome}" na tarefa; sem telefone do indicado ou com a busca falhando, avisa que vai para o principal. */
export function ReturnContactNotice({
  contact,
  failed,
}: {
  contact: CallbackTarget | null;
  failed: boolean;
}) {
  if (failed) {
    return (
      <p
        className="text-sm font-medium text-amber-700 dark:text-amber-400"
        role="alert"
        data-testid="return-contact-failed"
      >
        Não consegui carregar o contato do retorno. Ligando para o principal.
      </p>
    );
  }
  if (!contact) return null;
  return (
    <CallbackContactNotice
      contact={{ name: contact.name, contactId: contact.phone ? contact.contactId : null }}
    />
  );
}

export function ReturnContactLoading() {
  return (
    <p className="text-muted-foreground text-xs" role="status" data-testid="return-contact-loading">
      Carregando o contato do retorno…
    </p>
  );
}
