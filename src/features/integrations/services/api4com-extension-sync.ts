// Plano de sincronização dos ramais da API4COM com os usuários da org. Módulo PURO.
//
// Fonte: `GET /extensions` (token da conta) devolve, por ramal, `ramal`,
// `senha` (SIP), `domain` e `email_address`. Regras (story
// api4com-embedded-webphone, decisão de 21/10/2026):
//
//  1. Usuário que JÁ tem linha em `api4com_connections` casa pelo NÚMERO do
//     ramal — a linha é a fonte da verdade. A sincronização só completa
//     domínio, senha SIP e id do ramal. Ramal que sumiu da conta → `missing`.
//  2. Usuário SEM linha casa pelo e-mail (minúsculas, sem o sufixo `+alias`).
//     Um ramal → `create`. Mais de um → `ambiguous` (o gestor escolhe).
//     Nenhum → `unmatched`.
//
// Por que não casar todo mundo por e-mail: a integração da matriz criou um
// segundo ramal para cada pessoa do time (1047–1054), então o e-mail sozinho é
// ambíguo para quem já liga pelo EnriqueceAI.

export interface Api4ComExtension {
  id: number | string;
  domain: string;
  ramal: string;
  senha?: string | null;
  bina?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email_address?: string | null;
}

export interface SyncMember {
  userId: string;
  email: string | null;
}

export interface SyncConnection {
  userId: string;
  ramal: string;
}

export interface SyncPlan {
  /** Linha existente casada pelo ramal: completar domínio/senha/id. */
  keep: Array<{ userId: string; ramal: string; extension: Api4ComExtension }>;
  /** Linha existente cujo ramal não existe mais na conta. */
  missing: Array<{ userId: string; ramal: string }>;
  /** Usuário sem linha com exatamente um ramal para o e-mail. */
  create: Array<{ userId: string; email: string; extension: Api4ComExtension }>;
  /** Usuário sem linha com mais de um ramal para o e-mail. */
  ambiguous: Array<{ userId: string; email: string; ramais: string[] }>;
  /** Usuário sem linha e sem ramal para o e-mail (ou sem e-mail). */
  unmatched: Array<{ userId: string; email: string | null }>;
}

/** `Vinicius.Mercante+1@v4company.com` → `vinicius.mercante@v4company.com`. */
export function normalizeSyncEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  if (!value || !value.includes('@')) return null;
  const at = value.lastIndexOf('@');
  const local = value.slice(0, at).replace(/\+.*$/, '');
  const domain = value.slice(at + 1);
  return local && domain ? `${local}@${domain}` : null;
}

export function normalizeRamal(ramal: string | number | null | undefined): string {
  return String(ramal ?? '').replace(/\D/g, '');
}

export function planExtensionSync(
  extensions: Api4ComExtension[],
  members: SyncMember[],
  connections: SyncConnection[],
): SyncPlan {
  const plan: SyncPlan = { keep: [], missing: [], create: [], ambiguous: [], unmatched: [] };

  const byRamal = new Map<string, Api4ComExtension>();
  const byEmail = new Map<string, Api4ComExtension[]>();
  for (const ext of extensions) {
    const ramal = normalizeRamal(ext.ramal);
    if (ramal && !byRamal.has(ramal)) byRamal.set(ramal, ext);
    const email = normalizeSyncEmail(ext.email_address);
    if (email) {
      const list = byEmail.get(email) ?? [];
      list.push(ext);
      byEmail.set(email, list);
    }
  }

  const connectionByUser = new Map<string, SyncConnection>();
  for (const c of connections) connectionByUser.set(c.userId, c);

  for (const member of members) {
    const existing = connectionByUser.get(member.userId);
    if (existing) {
      const ramal = normalizeRamal(existing.ramal);
      const ext = byRamal.get(ramal);
      if (ext) plan.keep.push({ userId: member.userId, ramal, extension: ext });
      else plan.missing.push({ userId: member.userId, ramal: existing.ramal });
      continue;
    }

    const email = normalizeSyncEmail(member.email);
    const candidates = email ? (byEmail.get(email) ?? []) : [];
    if (!email || candidates.length === 0) {
      plan.unmatched.push({ userId: member.userId, email: member.email });
    } else if (candidates.length === 1) {
      plan.create.push({ userId: member.userId, email, extension: candidates[0]! });
    } else {
      plan.ambiguous.push({
        userId: member.userId,
        email,
        ramais: candidates.map((c) => normalizeRamal(c.ramal)).sort(),
      });
    }
  }

  return plan;
}

/** Domínio da conta a partir dos ramais (todos os ramais de uma conta têm o mesmo). */
export function pickAccountDomain(extensions: Api4ComExtension[]): string | null {
  const counts = new Map<string, number>();
  for (const ext of extensions) {
    const d = ext.domain?.trim().toLowerCase();
    if (!d) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [d, n] of counts) {
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}
