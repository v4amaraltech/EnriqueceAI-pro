// Qual org pode receber um evento de webhook da API4COM? Módulo PURO.
//
// Ramal NÃO identifica a org: cada unidade tem a própria conta API4COM, e os
// números de ramal se repetem entre contas (10/set/2026: 1024 e 1028 existem na
// V4 Amaral E na V4 Company Julio Cesar). O webhook casava ligação e criava
// ligação "externa" só pelo ramal — um evento da conta do Julio no ramal 1024
// iria parar na Amaral.
//
// O que identifica a conta é o `domain` do payload (ex.: `v4amaral.api4com.com`),
// que é o mesmo valor que a org já guarda em `api4com_connections.sip_domain`
// (o domínio SIP é por conta — igual para todos os SDRs da org, ver
// `get-api4com-sip-credentials.ts`).
//
// REGRA
//  1. Orgs com alguma conexão cujo `sip_domain` = domínio do evento → só elas.
//  2. Nenhuma org tem esse domínio → só as orgs que ainda NÃO têm domínio
//     cadastrado (comportamento antigo, restrito a quem não foi mapeado). Uma org
//     já mapeada nunca recebe evento de domínio alheio.
//  3. Todas as orgs mapeadas e domínio desconhecido → ninguém (evento ignorado
//     no casamento por ramal/criação; o casamento por id segue valendo).

export interface Api4ComConnectionScopeRow {
  org_id: string;
  user_id: string;
  ramal: string;
  sip_domain: string | null;
}

export function normalizeApi4ComDomain(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v ? v : null;
}

/** Org ids que podem receber um evento do `domain` informado. */
export function resolveApi4ComOrgScope(
  connections: Api4ComConnectionScopeRow[],
  domain: string | null | undefined,
): string[] {
  const wanted = normalizeApi4ComDomain(domain);
  const mappedOrgs = new Set<string>();
  const matchingOrgs = new Set<string>();

  for (const c of connections) {
    const d = normalizeApi4ComDomain(c.sip_domain);
    if (!d) continue;
    mappedOrgs.add(c.org_id);
    if (wanted && d === wanted) matchingOrgs.add(c.org_id);
  }

  if (matchingOrgs.size > 0) return [...matchingOrgs];

  const unmapped = new Set<string>();
  for (const c of connections) {
    if (!mappedOrgs.has(c.org_id)) unmapped.add(c.org_id);
  }
  return [...unmapped];
}

/**
 * Conexão do ramal DENTRO do escopo. `null` se não houver ou se houver mais de
 * uma (ambíguo — não chutar).
 */
export function pickApi4ComConnectionForRamal(
  connections: Api4ComConnectionScopeRow[],
  orgScope: string[],
  ramal: string,
): Api4ComConnectionScopeRow | null {
  const scope = new Set(orgScope);
  const hits = connections.filter((c) => scope.has(c.org_id) && c.ramal === ramal);
  return hits.length === 1 ? hits[0]! : null;
}
