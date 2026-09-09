/**
 * Guarda contra a reincidência do incidente de 09/09/2026.
 *
 * `20260909184311_auto_loss_after_cadence_completed.sql` recriou
 * `fetch_inactive_enrollment_candidates` com DROP + CREATE. O DROP descartou a
 * ACL e o CREATE herdou o default privilege do schema `public`, que concede
 * EXECUTE a PUBLIC — logo, a `anon` e `authenticated`. O REVOKE feito em
 * `20260516160057` não sobreviveu: REVOKE age sobre o objeto, não sobre o nome.
 *
 * Este teste roda sem banco (varre os .sql do repositório) e falha quando uma
 * migration reintroduz o padrão. É a única camada que pega o problema ANTES do
 * merge — a conferência de `proacl` em produção (scripts/audits/definer-exec-audit.sql)
 * só pega depois de aplicado.
 */

import { readdirSync, readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');
const ALLOWLIST_PATH = path.resolve(__dirname, '../../supabase/security/definer-exec-allowlist.json');

/** Comentários de linha (`-- ...`) viram espaço: um REVOKE comentado não conta. */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ');
}

/** Nomes de função alvo de um `DROP FUNCTION [IF EXISTS] [public.]nome(...)`. */
function droppedFunctions(sql: string): string[] {
  const re = /\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;
  return [...sql.matchAll(re)].map((m) => (m[1] ?? '').toLowerCase()).filter(Boolean);
}

/**
 * Nomes recriados como SECURITY DEFINER. O corpo de uma função pode conter
 * `$function$ ... $function$` com qualquer coisa dentro, então a janela de busca
 * do `SECURITY DEFINER` é limitada ao trecho entre o CREATE e o `AS $`.
 */
function createdDefinerFunctions(sql: string): string[] {
  const re =
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(([\s\S]*?)\)([\s\S]*?)\bAS\s+\$/gi;
  const out: string[] = [];
  for (const m of sql.matchAll(re)) {
    const name = (m[1] ?? '').toLowerCase();
    const afterArgs = m[3] ?? '';
    if (name && /\bSECURITY\s+DEFINER\b/i.test(afterArgs)) out.push(name);
  }
  return out;
}

/** Funções que receberam `REVOKE ... FROM ... PUBLIC` no mesmo arquivo. */
function revokedFromPublic(sql: string): Set<string> {
  const re =
    /\bREVOKE\s+(?:ALL|EXECUTE)[\s\S]*?\bON\s+FUNCTION\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\([\s\S]*?\)\s*FROM\s+([^;]+);/gi;
  const out = new Set<string>();
  for (const m of sql.matchAll(re)) {
    const name = (m[1] ?? '').toLowerCase();
    const targets = (m[2] ?? '').toLowerCase();
    if (name && /\bpublic\b/.test(targets)) out.add(name);
  }
  return out;
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

describe('migrations: DROP + CREATE de SECURITY DEFINER', () => {
  it('sempre revogam EXECUTE de PUBLIC no mesmo arquivo', () => {
    const offenders: string[] = [];

    for (const file of migrationFiles()) {
      const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));

      const dropped = new Set(droppedFunctions(sql));
      if (dropped.size === 0) continue;

      const recreatedAsDefiner = createdDefinerFunctions(sql).filter((n) => dropped.has(n));
      if (recreatedAsDefiner.length === 0) continue;

      const revoked = revokedFromPublic(sql);
      for (const name of new Set(recreatedAsDefiner)) {
        if (!revoked.has(name)) offenders.push(`${file} → public.${name}`);
      }
    }

    expect(
      offenders,
      [
        'Migration(s) recriando função SECURITY DEFINER via DROP + CREATE sem revogar EXECUTE de PUBLIC:',
        ...offenders.map((o) => `  - ${o}`),
        '',
        'O DROP descarta a ACL e o CREATE herda o default privilege do schema public,',
        'que concede EXECUTE a PUBLIC — ou seja, a anon e authenticated. Um REVOKE feito',
        'numa migration antiga NÃO sobrevive ao DROP: ele agiu sobre o objeto, não sobre o nome.',
        '',
        'Acrescente no mesmo arquivo, logo após o CREATE:',
        '  REVOKE EXECUTE ON FUNCTION public.<nome>(<assinatura>) FROM anon, authenticated, PUBLIC;',
        'e, se algum role precisar chamar, um GRANT explícito depois.',
        '',
        'Se a função realmente pode ser chamada pelo cliente, registre-a também em',
        'supabase/security/definer-exec-allowlist.json com a justificativa.',
      ].join('\n'),
    ).toEqual([]);
  });
});

describe('allowlist de EXECUTE em SECURITY DEFINER', () => {
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as {
    functions: Array<{
      name?: string;
      signature?: string;
      roles?: string[];
      category?: string;
      reason?: string;
    }>;
  };

  it('tem entradas bem formadas', () => {
    expect(Array.isArray(allowlist.functions)).toBe(true);
    expect(allowlist.functions.length).toBeGreaterThan(0);

    for (const fn of allowlist.functions) {
      expect(fn.name, `entrada sem "name": ${JSON.stringify(fn)}`).toBeTruthy();
      expect(fn.signature, `${fn.name}: falta "signature"`).toBeTruthy();
      expect(fn.reason, `${fn.name}: falta "reason" — explique por que pode ser chamada pelo cliente`).toBeTruthy();
      expect(fn.roles?.length, `${fn.name}: "roles" vazio`).toBeGreaterThan(0);
      expect(
        ['rls-helper', 'client-rpc', 'public-shared-secret'],
        `${fn.name}: category inválida (${fn.category})`,
      ).toContain(fn.category);
      expect(fn.signature?.startsWith(`${fn.name}(`), `${fn.name}: signature não bate com o name`).toBe(true);
    }
  });

  it('não tem nomes duplicados', () => {
    const names = allowlist.functions.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('preserva os helpers de RLS e seus roles de infraestrutura', () => {
    // Revogar EXECUTE destes derruba a aplicação (166/63/2 policies) e, no caso
    // de authenticator/supabase_realtime_admin, o Realtime — ver o incidente
    // registrado em realtime-rls-helper-execute-revoked.
    for (const name of ['user_org_id', 'is_manager', 'lead_visibility_mode']) {
      const fn = allowlist.functions.find((f) => f.name === name);
      expect(fn, `${name} sumiu da allowlist`).toBeDefined();
      expect(fn?.category).toBe('rls-helper');
      expect(fn?.roles).toContain('authenticated');
      expect(fn?.roles).toContain('authenticator');
      expect(fn?.roles).toContain('supabase_realtime_admin');
    }
  });
});
