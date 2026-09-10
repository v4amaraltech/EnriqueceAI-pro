// Integração `webhook` da API4COM — a que de fato entrega os eventos de ligação.
// Módulo PURO (planeja; quem chama a API é a rota admin).
//
// Diagnóstico de 10/set/2026: a integração que o cron `reregister` configura
// (a primeira da conta: sippulse/amocrm/salesforce…) tem `webhookConstraint`
// de gateway, e o discador manda `gateway: flux-{orgId}` → a API4COM filtra
// todas as ligações. O que funciona na V4 Amaral é OUTRA integração, gateway
// `webhook`, SEM filtro, apontando para o n8n (que repassa para
// `/api/webhooks/api4com`). A conta do Julio Cesar tinha essa integração só no
// ramal 1025 e com a URL do EDITOR do n8n.
//
// API (developers.api4com.com, UserIntegration.overrideUpsert):
// `PATCH /integrations` — sem `id` cria, com `id` atualiza. Uma por gateway.
// NÃO mexe em nenhuma outra integração da conta.

export const CALL_WEBHOOK_GATEWAY = 'webhook';
export const CALL_WEBHOOK_TYPES = ['channel-hangup', 'channel-answer'] as const;
/** Versão usada por 5 das 6 integrações `webhook` da Amaral (payload que o handler lê). */
export const CALL_WEBHOOK_DEFAULT_VERSION = 'v1.4';

export interface CallWebhookTarget {
  webhookUrl: string;
  webhookVersion: string;
}

export type CallWebhookPlan =
  | { action: 'noop'; integrationId: unknown }
  | { action: 'update'; integrationId: unknown; body: Record<string, unknown> }
  | { action: 'create'; body: Record<string, unknown> };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sameTypes(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const got = [...value].map(String).sort();
  const want = [...CALL_WEBHOOK_TYPES].sort();
  return got.length === want.length && got.every((t, i) => t === want[i]);
}

/** A integração `webhook` da conta, se existir. */
export function findCallWebhookIntegration(integrations: unknown[]): Record<string, unknown> | null {
  for (const raw of integrations) {
    const rec = asRecord(raw);
    if (rec?.gateway === CALL_WEBHOOK_GATEWAY) return rec;
  }
  return null;
}

/**
 * O que fazer para a conta entregar os eventos em `target.webhookUrl`, sem
 * filtro de gateway. `webhookConstraint` com filtro existente é o único caso em
 * que o atualizamos (para `{}`); sem filtro, o campo não é enviado.
 */
export function planCallWebhookIntegration(
  integrations: unknown[],
  target: CallWebhookTarget,
): CallWebhookPlan {
  const metadataPatch = {
    webhookUrl: target.webhookUrl,
    webhookVersion: target.webhookVersion,
    webhookTypes: [...CALL_WEBHOOK_TYPES],
  };

  const existing = findCallWebhookIntegration(integrations);
  if (!existing) {
    return {
      action: 'create',
      body: { gateway: CALL_WEBHOOK_GATEWAY, webhook: true, metadata: metadataPatch },
    };
  }

  const metadata = asRecord(existing.metadata) ?? {};
  const constraint = asRecord(existing.webhookConstraint);
  const hasConstraint = constraint !== null && Object.keys(constraint).length > 0;

  const alreadyOk =
    existing.webhook === true &&
    !hasConstraint &&
    metadata.webhookUrl === target.webhookUrl &&
    metadata.webhookVersion === target.webhookVersion &&
    sameTypes(metadata.webhookTypes);
  if (alreadyOk) return { action: 'noop', integrationId: existing.id ?? null };

  return {
    action: 'update',
    integrationId: existing.id ?? null,
    body: {
      id: existing.id,
      gateway: CALL_WEBHOOK_GATEWAY,
      webhook: true,
      ...(hasConstraint ? { webhookConstraint: {} } : {}),
      metadata: { ...metadata, ...metadataPatch },
    },
  };
}

/** Só aceita https — a URL vai para a conta do cliente na API4COM. */
export function isValidCallWebhookUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
