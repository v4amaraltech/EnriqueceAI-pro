// Resumo SEGURO da configuração API4COM para a rota de diagnóstico
// (`/api/admin/check-api4com-config`). Módulo PURO.
//
// Motivação (10/set/2026): a org V4 Company Julio Cesar nunca recebeu webhook
// (0 eventos desde 01/set) mesmo com o re-registro respondendo `success`. O
// registro grava `webhookConstraint: { metadata: { gateway: <gateway da
// integração> } }`, e o discador manda `gateway: flux-{orgId}` na ligação
// (`initiate-api4com-call.ts`). Se os dois não batem, a API4COM filtra todas as
// ligações do discador. A rota antiga buscava `/integrations` e descartava a
// resposta — este módulo expõe o que importa para comparar.
//
// NUNCA devolve a api key nem o `?token=` da URL do webhook (é o segredo
// compartilhado que autentica os eventos).

export interface WebhookUrlSummary {
  host: string;
  path: string;
  hasToken: boolean;
}

export interface Api4ComIntegrationSummary {
  id: unknown;
  gateway: string | null;
  webhookEnabled: boolean | null;
  /** `webhookConstraint.metadata.gateway` — o filtro que a API4COM aplica. */
  constraintGateway: string | null;
  webhookUrl: WebhookUrlSummary | null;
  webhookTypes: unknown;
  webhookVersion: unknown;
  /** Só os NOMES das chaves de metadata, para ver o que mais existe lá. */
  metadataKeys: string[];
}

export interface Api4ComRecentCallSummary {
  id: unknown;
  from: unknown;
  started_at: unknown;
  duration: unknown;
  hangup_cause: unknown;
  gateway: string | null;
  hasRecording: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Host + path da URL do webhook, sem query string (onde mora o token). */
export function describeWebhookUrl(value: unknown): WebhookUrlSummary | null {
  const raw = asString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return { host: url.host, path: url.pathname, hasToken: url.searchParams.has('token') };
  } catch {
    return { host: '(url inválida)', path: '', hasToken: false };
  }
}

export function summarizeIntegration(raw: unknown): Api4ComIntegrationSummary {
  const rec = asRecord(raw) ?? {};
  const metadata = asRecord(rec.metadata) ?? {};
  const constraint = asRecord(rec.webhookConstraint);
  const constraintMeta = asRecord(constraint?.metadata);
  return {
    id: rec.id ?? null,
    gateway: asString(rec.gateway),
    webhookEnabled: typeof rec.webhook === 'boolean' ? rec.webhook : null,
    constraintGateway: asString(constraintMeta?.gateway),
    webhookUrl: describeWebhookUrl(metadata.webhookUrl),
    webhookTypes: metadata.webhookTypes ?? null,
    webhookVersion: metadata.webhookVersion ?? null,
    metadataKeys: Object.keys(metadata).sort(),
  };
}

export function summarizeRecentCall(raw: unknown): Api4ComRecentCallSummary {
  const rec = asRecord(raw) ?? {};
  const metadata = asRecord(rec.metadata);
  return {
    id: rec.id ?? null,
    from: rec.from ?? null,
    started_at: rec.started_at ?? null,
    duration: rec.duration ?? null,
    hangup_cause: rec.hangup_cause ?? null,
    gateway: asString(metadata?.gateway),
    hasRecording: Boolean(rec.record_url),
  };
}

/** Gateway que o discador do Enriquece manda em toda ligação da org. */
export function dialerGatewayForOrg(orgId: string): string {
  return `flux-${orgId}`;
}

/**
 * O filtro do webhook deixa passar as ligações do discador? `null` quando a
 * integração não tem filtro de gateway (aí o filtro não é a causa).
 */
export function dialerPassesWebhookConstraint(
  integration: Api4ComIntegrationSummary,
  orgId: string,
): boolean | null {
  if (!integration.constraintGateway) return null;
  return integration.constraintGateway === dialerGatewayForOrg(orgId);
}
