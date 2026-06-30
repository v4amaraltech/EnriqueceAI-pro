export interface CrmFetchInit extends RequestInit {
  /** Rótulo do provedor para a mensagem de erro (ex.: 'HubSpot', 'Kommo'). */
  label: string;
}

/**
 * Núcleo HTTP compartilhado pelos adapters de CRM. Cada adapter monta a URL e os
 * headers (auth varia: Bearer vs token na query) e delega aqui o comum:
 *  - timeout de 15s (endpoint externo lento não pode pendurar o cron/Server Action);
 *  - 204 No Content → objeto vazio (Kommo responde 204 em alguns updates);
 *  - erro padronizado `<label> API error (<status>): <body>` quando !ok;
 *  - parse do JSON tipado.
 */
export async function crmFetch<T>(url: string, init: CrmFetchInit): Promise<T> {
  const { label, ...rest } = init;
  const response = await fetch(url, {
    ...rest,
    signal: rest.signal ?? AbortSignal.timeout(15_000),
  });

  if (response.status === 204) {
    return {} as T;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${label} API error (${response.status}): ${errorText}`);
  }

  return (await response.json()) as T;
}
