import type { NextCallCardData } from '../types';

/** "Retorno com {nome}": avisa para quem é a ligação; sem telefone do indicado, diz que vai para o principal. */
export function CallbackContactNotice({
  contact,
}: {
  contact: NextCallCardData['callbackContact'];
}) {
  if (!contact) return null;
  return (
    <p className="text-sm font-medium" data-testid="callback-contact">
      Retorno com {contact.name}
      {contact.contactId === null && (
        <span className="text-amber-700 dark:text-amber-400">
          {' · '}
          {contact.refused ? 'número do indicado recusado' : 'sem telefone cadastrado'}, ligando
          para o principal
        </span>
      )}
    </p>
  );
}
