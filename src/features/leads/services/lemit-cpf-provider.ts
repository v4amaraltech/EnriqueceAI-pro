/**
 * Lemit CPF provider — enriches partner data via CPF endpoint.
 * Returns personal contact info: emails, phones (with WhatsApp flag), address.
 * Endpoint: {apiUrl}/consulta/pessoa/{cpf}
 */

export interface CpfEnrichmentData {
  nome: string;
  emails: Array<{ email: string; ranking: number }>;
  celulares: Array<{ ddd: number; numero: string; whatsapp: boolean; ranking: number }>;
  endereco?: { endereco: string; bairro: string; cidade: string; uf: string; cep: string };
}

export interface CpfEnrichmentResult {
  success: boolean;
  data?: CpfEnrichmentData;
  error?: string;
}

const LEMIT_CPF_TIMEOUT_MS = 15_000;

export class LemitCpfProvider {
  private apiUrl: string;
  private token: string;

  constructor(apiUrl: string, token: string) {
    this.apiUrl = apiUrl;
    this.token = token;
  }

  async enrich(cpf: string): Promise<CpfEnrichmentResult> {
    try {
      const response = await fetch(`${this.apiUrl}/consulta/pessoa/${cpf}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        signal: AbortSignal.timeout(LEMIT_CPF_TIMEOUT_MS),
      });

      if (response.status === 429) {
        return { success: false, error: 'Rate limit exceeded' };
      }

      if (response.status === 404) {
        return { success: false, error: 'CPF not found' };
      }

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const raw = await response.json();
      return {
        success: true,
        data: this.mapResponse(raw),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  private mapResponse(raw: Record<string, unknown>): CpfEnrichmentData {
    const pessoa = (raw.pessoa ?? raw) as Record<string, unknown>;
    const emails = (pessoa.emails as Array<Record<string, unknown>> | undefined) ?? [];
    const celulares = (pessoa.celulares as Array<Record<string, unknown>> | undefined) ?? [];
    const enderecos = pessoa.enderecos as Array<Record<string, unknown>> | undefined;

    return {
      nome: (pessoa.nome as string) ?? '',
      emails: emails.map((e) => ({
        email: e.email as string,
        ranking: (e.ranking as number) ?? 99,
      })),
      celulares: celulares.map((c) => ({
        ddd: c.ddd as number,
        numero: c.numero as string,
        whatsapp: (c.whatsapp as boolean) ?? false,
        ranking: (c.ranking as number) ?? 99,
      })),
      endereco:
        enderecos && enderecos.length > 0
          ? {
              endereco: (enderecos[0]!.endereco as string) ?? '',
              bairro: (enderecos[0]!.bairro as string) ?? '',
              cidade: (enderecos[0]!.cidade as string) ?? '',
              uf: (enderecos[0]!.uf as string) ?? '',
              cep: (enderecos[0]!.cep as string) ?? '',
            }
          : undefined,
    };
  }
}
