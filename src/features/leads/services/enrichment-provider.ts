/**
 * Enrichment provider abstraction.
 * Supports CNPJ.ws (free, basic data) and Lemit (premium, contact data).
 */

/**
 * Infer "Sócio" or "Sócia" from the person's first name.
 * Heuristic: Brazilian female names typically end in "a".
 */
export function inferQualificacao(nome: string): string {
  const firstName = nome.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return firstName.endsWith('a') ? 'Sócia' : 'Sócio';
}

const CNPJ_WS_TIMEOUT_MS = 10_000;
const LEMIT_TIMEOUT_MS = 15_000;

export interface EnrichmentData {
  razao_social?: string;
  nome_fantasia?: string;
  endereco?: {
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
  };
  porte?: string;
  cnae?: string;
  situacao_cadastral?: string;
  email?: string;
  telefone?: string;
  socios?: Array<{
    nome: string;
    qualificacao?: string;
    cpf_masked?: string;
    cpf?: string;
    participacao?: number;
    capital_social?: number;
  }>;
  faturamento_estimado?: number;
}

export interface EnrichmentResult {
  success: boolean;
  data?: EnrichmentData;
  error?: string;
}

export interface EnrichmentProvider {
  name: string;
  enrich(cnpj: string): Promise<EnrichmentResult>;
}

/**
 * CNPJ.ws provider — free, basic cadastral data.
 * Rate limit: 3 requests/minute.
 */
export class CnpjWsProvider implements EnrichmentProvider {
  name = 'cnpj_ws';
  private baseUrl: string;

  constructor(baseUrl = 'https://publica.cnpj.ws/cnpj') {
    this.baseUrl = baseUrl;
  }

  async enrich(cnpj: string): Promise<EnrichmentResult> {
    try {
      const response = await fetch(`${this.baseUrl}/${cnpj}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(CNPJ_WS_TIMEOUT_MS),
      });

      if (response.status === 429) {
        return { success: false, error: 'Rate limit exceeded' };
      }

      if (response.status === 404) {
        return { success: false, error: 'CNPJ not found' };
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

  private mapResponse(raw: Record<string, unknown>): EnrichmentData {
    const estabelecimento = raw.estabelecimento as Record<string, unknown> | undefined;
    const socios = raw.socios as Array<Record<string, unknown>> | undefined;

    return {
      razao_social: raw.razao_social as string | undefined,
      nome_fantasia: (estabelecimento?.nome_fantasia as string) || undefined,
      endereco: estabelecimento
        ? {
            logradouro: estabelecimento.logradouro as string | undefined,
            numero: estabelecimento.numero as string | undefined,
            complemento: estabelecimento.complemento as string | undefined,
            bairro: estabelecimento.bairro as string | undefined,
            cidade: (estabelecimento.cidade as Record<string, unknown>)?.nome as string | undefined,
            uf: (estabelecimento.estado as Record<string, unknown>)?.sigla as string | undefined,
            cep: estabelecimento.cep as string | undefined,
          }
        : undefined,
      porte: (raw.porte as Record<string, unknown>)?.descricao as string | undefined,
      cnae: (estabelecimento?.atividade_principal as Record<string, unknown>)?.id as string | undefined,
      situacao_cadastral: (estabelecimento?.situacao_cadastral as string) || undefined,
      socios: socios?.map((s) => ({
        nome: s.nome as string,
        qualificacao:
          ((s.qualificacao as Record<string, unknown>)?.descricao as string | undefined) ||
          inferQualificacao(s.nome as string),
      })),
    };
  }
}

/**
 * Lemit provider — premium enrichment via CNPJ endpoint.
 * Returns company data + partners with full CPF.
 * Endpoint: {apiUrl}/consulta/empresa/{cnpj}
 */
export class LemitProvider implements EnrichmentProvider {
  name = 'lemit';
  private apiUrl: string;
  private token: string;

  constructor(apiUrl: string, token: string) {
    this.apiUrl = apiUrl;
    this.token = token;
  }

  async enrich(cnpj: string): Promise<EnrichmentResult> {
    try {
      const response = await fetch(`${this.apiUrl}/consulta/empresa/${cnpj}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        signal: AbortSignal.timeout(LEMIT_TIMEOUT_MS),
      });

      if (response.status === 429) {
        return { success: false, error: 'Rate limit exceeded' };
      }

      if (response.status === 404) {
        return { success: false, error: 'CNPJ not found' };
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

  private mapResponse(raw: Record<string, unknown>): EnrichmentData {
    const empresa = (raw.empresa ?? raw) as Record<string, unknown>;
    const socios = empresa.socios as Array<Record<string, unknown>> | undefined;
    const enderecoRaw = empresa.endereco as Record<string, unknown> | undefined;
    const emails = empresa.emails as Array<Record<string, unknown>> | undefined;
    const celulares = empresa.celulares as Array<Record<string, unknown>> | undefined;
    const cnaeRaw = empresa.cnae as Record<string, unknown> | undefined;

    // Pick best phone: first celular sorted by ranking
    let telefone: string | undefined;
    if (celulares && celulares.length > 0) {
      const best = celulares.sort(
        (a, b) => ((a.ranking as number) ?? 99) - ((b.ranking as number) ?? 99),
      )[0];
      const ddd = best?.ddd as number;
      const numero = best?.numero as string;
      telefone = `(${ddd}) ${numero}`;
    }

    return {
      razao_social: empresa.razao_social as string | undefined,
      nome_fantasia: empresa.nome_fantasia as string | undefined,
      endereco: enderecoRaw
        ? {
            logradouro: enderecoRaw.logradouro as string | undefined,
            numero: enderecoRaw.numero as string | undefined,
            complemento: enderecoRaw.complemento as string | undefined,
            bairro: enderecoRaw.bairro as string | undefined,
            cidade: enderecoRaw.cidade as string | undefined,
            uf: enderecoRaw.uf as string | undefined,
            cep: enderecoRaw.cep as string | undefined,
          }
        : undefined,
      porte: empresa.tipo as string | undefined,
      cnae: cnaeRaw?.numero as string | undefined,
      situacao_cadastral: empresa.situacao as string | undefined,
      email: emails && emails.length > 0 ? (emails[0]?.email as string) : undefined,
      telefone,
      faturamento_estimado: empresa.faturamento_estimado as number | undefined,
      socios: socios?.map((s) => ({
        nome: s.nome as string,
        qualificacao: (s.qualificacao as string | undefined) || inferQualificacao(s.nome as string),
        cpf_masked: s.cpf_masked as string | undefined,
        cpf: s.cpf as string | undefined,
        participacao: s.participacao as number | undefined,
        capital_social: s.capital_social as number | undefined,
      })),
    };
  }
}
