import { cookies } from 'next/headers';

import type { MemberRole } from './require-auth-with-member';

/**
 * "Ver como SDR" — ferramenta SÓ de desenvolvimento.
 *
 * No `pnpm dev`, um gestor pode marcar o cookie `dev_view_as=sdr` (pela chave
 * flutuante no canto da tela) para o app tratá-lo como SDR: menus, botões,
 * páginas só de gestor e o escopo das Server Actions. O banco (RLS /
 * `is_manager()`) continua vendo o usuário real — só a camada do app muda.
 *
 * Fora de `NODE_ENV === 'development'` nada disso tem efeito: o cookie é
 * ignorado e o papel real é sempre devolvido.
 */
export const DEV_VIEW_AS_COOKIE = 'dev_view_as';

export function isDevViewAsAvailable(): boolean {
  return process.env.NODE_ENV === 'development';
}

/** Lê o cookie; `true` quando o dev pediu para ver como SDR. */
export async function isDevViewingAsSdr(): Promise<boolean> {
  if (!isDevViewAsAvailable()) return false;
  try {
    return (await cookies()).get(DEV_VIEW_AS_COOKIE)?.value === 'sdr';
  } catch {
    // Fora de um request (ex.: script) não há cookies — usa o papel real.
    return false;
  }
}

/**
 * Papel efetivo: o real, ou `sdr` quando um gestor está simulando a visão de
 * SDR no localhost. Só rebaixa (gestor → SDR); nunca promove um SDR.
 */
export async function effectiveRole<R extends string>(realRole: R): Promise<R | 'sdr'> {
  if (realRole !== 'manager') return realRole;
  return (await isDevViewingAsSdr()) ? 'sdr' : realRole;
}

export type { MemberRole };
