'use client';

import { useEffect, useState } from 'react';

import type { CallbackTarget } from '@/features/cockpit/services/callback-contact.service';

import { fetchReturnContact } from '../actions/fetch-return-contact';
import type { PendingActivity } from '../types';
import { type ResolvedPhone, getAllLeadPhones } from '../utils/resolve-whatsapp-phone';

/** Passado isto sem resposta, a tarefa abre com o principal (a Server Action pode estar na fila). */
export const RETURN_CONTACT_TIMEOUT_MS = 10_000;

/**
 * Contato do retorno desta tarefa. `ready: false` = ainda buscando: o painel de ligação NÃO pode montar, porque ele
 * guarda o número inicial em estado. Quem resolve primeiro vale (resposta atrasada não troca o número já na tela).
 * Tarefa sem contato (`returnContactId` ausente) nasce pronta e nada é buscado.
 */
export function useReturnContact(
  activity: Pick<PendingActivity, 'stepId' | 'returnContactId' | 'lead'>,
): {
  ready: boolean;
  contact: CallbackTarget | null;
  /** A busca falhou ou estourou o prazo (não confundir com "sem contato"). */
  failed: boolean;
} {
  const { stepId, returnContactId } = activity;
  const leadId = activity.lead.id;
  const [settled, setSettled] = useState<{
    stepId: string;
    contact: CallbackTarget | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!returnContactId) return;
    let done = false;
    const settle = (contact: CallbackTarget | null, failed = false) => {
      if (done) return;
      done = true;
      setSettled({ stepId, contact, failed });
    };
    const timer = setTimeout(() => settle(null, true), RETURN_CONTACT_TIMEOUT_MS);
    fetchReturnContact({ scheduledActivityId: stepId, leadId })
      .then((r) => (r.success ? settle(r.data) : settle(null, true)))
      .catch(() => settle(null, true));
    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, [stepId, leadId, returnContactId]);

  if (!returnContactId) return { ready: true, contact: null, failed: false };
  // `stepId` na resposta: nunca reaproveita o contato de outra tarefa.
  const mine = settled?.stepId === stepId ? settled : null;
  return { ready: mine !== null, contact: mine?.contact ?? null, failed: mine?.failed ?? false };
}

const dedupKey = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('55') && digits.length > 10 ? digits.slice(2) : digits;
};

/**
 * Lista de números de uma tarefa. Tarefa sem contato no retorno: intocada. Com o indicado: o número dele na frente
 * (pré-selecionado), com o `contactId`. Sem telefone, já atendeu ou erro: na frente o mesmo número que a tarefa abriria
 * hoje (`principal`), mesmo que os contatos do lead já tenham carregado em outra ordem.
 */
export function returnTaskPhones(
  activity: Pick<PendingActivity, 'returnContactId' | 'lead'>,
  phones: ResolvedPhone[],
  contact: CallbackTarget | null,
): ResolvedPhone[] {
  if (!activity.returnContactId) return phones;
  if (!contact?.phone) {
    const principal = getAllLeadPhones(activity.lead)[0];
    if (!principal) return phones;
    const same = phones.find((p) => p.raw === principal.raw) ?? principal;
    return [same, ...phones.filter((p) => p.raw !== principal.raw)];
  }
  const raw = dedupKey(contact.phone);
  const entry: ResolvedPhone = {
    formatted: contact.phone,
    raw,
    label: `${contact.jobTitle ? `${contact.name} · ${contact.jobTitle}` : contact.name} — Retorno ${contact.phone}`,
    source: 'contact',
    contactId: contact.contactId,
    contactName: contact.name,
    contactRole: contact.jobTitle,
  };
  return [entry, ...phones.filter((p) => p.raw !== raw && p.formatted !== contact.phone)];
}
