/**
 * `callRef`: identificador nosso por tentativa de ligação, enviado em
 * `metadata.callRef` do `POST /calls` da API4COM.
 *
 * O valor é o próprio `calls.id` (UUID gerado antes do POST). A API4COM devolve
 * todas as chaves do `metadata` do POST nos webhooks e no `GET /calls`, e aceita
 * filtrar por elas (`filter={"where":{"metadata.callRef":"..."}}`). Com isso o
 * webhook, o reconcile e a busca de gravação casam a linha local pelo id, sem
 * depender da janela de ramal + telefone + horário.
 *
 * O guia da API4COM pede identificadores simples, em texto e sem dados pessoais
 * no metadata. Não confundir com o `dialToken` do webphone (PR 562), que é só da
 * aba e nunca vai para a API4COM.
 */

export const CALL_REF_KEY = 'callRef';
export const GATEWAY_KEY = 'gateway';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Chaves reservadas: `extraMetadata` nunca as sobrescreve. */
const RESERVED_KEYS = new Set([CALL_REF_KEY.toLowerCase(), GATEWAY_KEY]);

/** Nomes de chave que indicam dado pessoal (telefone, nome, e-mail, documento, nota). */
const PERSONAL_KEY_RE =
  /phone|fone|tel|celular|whats|mail|nome|name|cpf|cnpj|document|endere|address|nota|note|coment|comment|message|mensagem/i;

const MAX_EXTRA_VALUE_LENGTH = 64;
const MAX_EXTRA_KEYS = 5;

/** O callRef é nosso e é sempre UUID; qualquer outra coisa é lixo. */
export function isUsableCallRef(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/** Valor de `extraMetadata` aceitável: identificador curto, sem cara de telefone ou e-mail. */
function isSimpleIdentifier(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v || v.length > MAX_EXTRA_VALUE_LENGTH) return false;
  if (v.includes('@') || /\s/.test(v)) return false;
  // 8 ou mais dígitos é telefone ou documento; UUID é permitido.
  if (!UUID_RE.test(v) && v.replace(/\D/g, '').length >= 8) return false;
  return /^[\w.:-]+$/.test(v);
}

/** `extraMetadata` filtrado: só identificadores simples, sem chaves reservadas nem pessoais. */
export function sanitizeExtraMetadata(extra: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!extra) return out;
  for (const [key, value] of Object.entries(extra)) {
    if (Object.keys(out).length >= MAX_EXTRA_KEYS) break;
    if (!/^[A-Za-z][\w]{0,39}$/.test(key)) continue;
    if (RESERVED_KEYS.has(key.toLowerCase())) continue;
    if (PERSONAL_KEY_RE.test(key)) continue;
    if (!isSimpleIdentifier(value)) continue;
    out[key] = value.trim();
  }
  return out;
}

/**
 * Metadata do `POST /calls`: sempre `gateway` e `callRef` em texto. O extra vem
 * filtrado e é aplicado ANTES, então nunca sobrescreve as duas chaves.
 */
export function buildOriginateMetadata(input: {
  gateway: string;
  callRef: string;
  extra?: Record<string, unknown> | null;
}): Record<string, string> {
  if (!isUsableCallRef(input.callRef)) throw new Error('callRef inválido');
  return {
    ...sanitizeExtraMetadata(input.extra),
    [GATEWAY_KEY]: String(input.gateway),
    [CALL_REF_KEY]: input.callRef,
  };
}

/** callRef de um metadata de webhook, de registro do GET /calls ou de `calls.metadata`. */
export function readCallRef(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)[CALL_REF_KEY];
  return isUsableCallRef(value) ? value.trim() : null;
}

/** Cláusula `where` do GET /calls (filtro LoopBack) para um callRef. */
export function callRefWhere(callRef: string): Record<string, string> {
  return { [`metadata.${CALL_REF_KEY}`]: callRef };
}

/**
 * Grava o id do provedor no metadata da linha, como merge (nunca apaga chaves):
 * sem primário, vira `api4com_call_id`; primário diferente vai para
 * `alt_api4com_ids` (o caso histórico de dois ids para a mesma ligação).
 * `webhookLinked` marca a linha como já casada com uma ligação da API4COM.
 * Devolve `changed: false` quando nada mudaria.
 */
export function linkProviderIdToMetadata(
  current: Record<string, unknown> | null | undefined,
  providerId: string,
  options: { webhookLinked?: boolean } = {},
): { metadata: Record<string, unknown>; changed: boolean } {
  const metadata: Record<string, unknown> = { ...(current ?? {}) };
  let changed = false;

  const primary = metadata.api4com_call_id;
  if (typeof primary !== 'string' || !primary) {
    metadata.api4com_call_id = providerId;
    changed = true;
  } else if (primary !== providerId) {
    const altIds = Array.isArray(metadata.alt_api4com_ids) ? (metadata.alt_api4com_ids as string[]) : [];
    if (!altIds.includes(providerId)) {
      metadata.alt_api4com_ids = [...altIds, providerId];
      changed = true;
    }
  }

  if (options.webhookLinked && metadata.webhook_linked !== true) {
    metadata.webhook_linked = true;
    changed = true;
  }

  return { metadata, changed };
}

/**
 * Procura a linha de um callRef: primeiro pela chave primária (`calls.id`),
 * depois por `metadata->>callRef`. Sem callRef usável, não consulta nada.
 */
export async function findCallByCallRef<T>(
  callRef: string | null,
  lookups: {
    byId: (id: string) => Promise<T | null>;
    byMetadata: (ref: string) => Promise<T | null>;
  },
): Promise<T | null> {
  if (!isUsableCallRef(callRef)) return null;
  return (await lookups.byId(callRef)) ?? (await lookups.byMetadata(callRef));
}
