// Detector PURO de pedido de opt-out falado numa ligação (transcrição e/ou resumo JEV).
//
// Conservador de propósito: só marca pedido CLARO de sair da lista ou de apagar,
// tirar ou remover telefone, e-mail, WhatsApp ou contato. "Não tenho interesse",
// "agora não", "me liga outro dia" NÃO são opt-out.
//
// É diferente de `isStopRequest` (contact-engine/consent-capture), que é amplo
// ("parar", "sair", "cancelar") porque lê mensagem curta de WhatsApp. Numa ligação
// essas palavras aparecem o tempo todo em contexto comum.
//
// Aqui só detectamos. Nada é aplicado: nenhum contato, lead, e-mail ou telefone é
// apagado ou reescrito, nenhuma supressão ou consentimento é gravado.

export type OptOutChannel = 'email' | 'phone' | 'whatsapp' | 'list';

export type OptOutPatternId = 'remove_contact' | 'leave_list' | 'unsubscribe_word';

export interface OptOutSignal {
  requested: boolean;
  /** Canais citados no pedido. `list` = pedido genérico de sair da lista/base. */
  channels: OptOutChannel[];
  /** Quais padrões bateram (só ids; o texto da ligação nunca é copiado). */
  patterns: OptOutPatternId[];
}

const NO_OPT_OUT: OptOutSignal = { requested: false, channels: [], patterns: [] };

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const VERB =
  '(?:tira|tirar|tire|tirem|remove|remover|remova|removam|exclui|excluir|exclua|excluam|apaga|apagar|apague|apaguem|elimina|eliminar|elimine|deleta|deletar|delete|descarta|descartar)';

/** Palavras curtas que podem ficar entre o verbo e o objeto ("tira ESSE MEU e-mail"). */
const FILLER =
  '(?:(?:o|a|os|as|meu|minha|meus|minhas|esse|essa|este|esta|seu|sua|nosso|nossa|me|ai|ja|logo|por favor|favor|tambem|todo|todos|de vez)\\s+){0,4}';

const CONTACT_OBJECT =
  '(?:e-?mail|email|telefone|numero|celular|whatsapp|whats|zap|contato|contatos|cadastro)';

/** "tira meu e-mail", "elimina meu telefone", "pode apagar o meu contato". */
const REMOVE_CONTACT_RE = new RegExp(
  `\\b${VERB}\\s+${FILLER}${CONTACT_OBJECT}\\b(?!\\s+(?:errado|antigo|velho|anterior))`,
  'g',
);

/** "me tira da lista", "quero sair da sua base", "me apaga do seu WhatsApp". */
const LEAVE_LIST_RE = new RegExp(
  `\\b(?:${VERB}|sair|saia)\\s+(?:(?:me|nos|a gente|meu nome|o meu nome|meu numero|o meu numero|meu contato|o meu contato)\\s+)?(?:da|das|do|dos|dessa|desta|dessas|desse|deste)\\s+(?:sua\\s+|seu\\s+|vossa\\s+|essa\\s+|esta\\s+)?(?:lista|listas|listagem|base|mailing|whatsapp|whats|zap|agenda|contatos)\\b`,
  'g',
);

const UNSUBSCRIBE_RE = /\bdescadastr\w*/g;

function channelsOf(fragment: string): OptOutChannel[] {
  const out: OptOutChannel[] = [];
  if (/e-?mail/.test(fragment)) out.push('email');
  if (/\b(?:telefone|numero|celular)\b/.test(fragment)) out.push('phone');
  if (/\b(?:whatsapp|whats|zap)\b/.test(fragment)) out.push('whatsapp');
  return out;
}

/** Procura pedido claro de opt-out em um ou mais textos (transcrição, resumo). */
export function detectOptOutRequest(...texts: Array<string | null | undefined>): OptOutSignal {
  const channels = new Set<OptOutChannel>();
  const patterns = new Set<OptOutPatternId>();

  for (const raw of texts) {
    if (!raw) continue;
    const t = normalize(raw);
    if (!t) continue;

    for (const m of t.matchAll(REMOVE_CONTACT_RE)) {
      patterns.add('remove_contact');
      const found = channelsOf(m[0]);
      if (found.length === 0) channels.add('list');
      found.forEach((c) => channels.add(c));
    }
    for (const m of t.matchAll(LEAVE_LIST_RE)) {
      patterns.add('leave_list');
      const found = channelsOf(m[0]);
      if (found.length === 0) channels.add('list');
      found.forEach((c) => channels.add(c));
    }
    if (UNSUBSCRIBE_RE.test(t)) {
      patterns.add('unsubscribe_word');
      channels.add('list');
    }
    UNSUBSCRIBE_RE.lastIndex = 0;
  }

  if (patterns.size === 0) return NO_OPT_OUT;
  const order: OptOutChannel[] = ['email', 'phone', 'whatsapp', 'list'];
  return {
    requested: true,
    channels: order.filter((c) => channels.has(c)),
    patterns: [...patterns],
  };
}

/**
 * Ação que um humano PODERIA tomar, só para documentação no log do shadow.
 * Nenhuma delas é executada por este módulo nem pelo worker.
 *  - email_suppressions: mesma supressão por (org, e-mail) gravada pelo /unsubscribe/[token].
 *  - contact_consent_evidence: opt_out append-only por identidade e canal (consent_capture_v1).
 *  - cadence_enrollments: parar inscrições ativas do lead (status 'unsubscribed').
 */
export interface OptOutSuggestedAction {
  target: 'email_suppressions' | 'contact_consent_evidence' | 'cadence_enrollments';
  channel: Exclude<OptOutChannel, 'list'> | null;
  note: string;
}

export function suggestOptOutActions(signal: OptOutSignal): OptOutSuggestedAction[] {
  if (!signal.requested) return [];
  const all = signal.channels.includes('list');
  const actions: OptOutSuggestedAction[] = [];
  if (all || signal.channels.includes('email')) {
    actions.push({
      target: 'email_suppressions',
      channel: 'email',
      note: "suprimir o e-mail do lead (reason 'unsubscribe', igual ao /unsubscribe/[token])",
    });
  }
  if (all || signal.channels.includes('whatsapp')) {
    actions.push({
      target: 'contact_consent_evidence',
      channel: 'whatsapp',
      note: 'registrar opt_out de WhatsApp (append-only)',
    });
  }
  if (all || signal.channels.includes('phone')) {
    actions.push({
      target: 'contact_consent_evidence',
      channel: 'phone',
      note: 'registrar opt_out de telefone (append-only)',
    });
  }
  actions.push({
    target: 'cadence_enrollments',
    channel: null,
    note: "parar inscrições ativas do lead (status 'unsubscribed')",
  });
  return actions;
}
