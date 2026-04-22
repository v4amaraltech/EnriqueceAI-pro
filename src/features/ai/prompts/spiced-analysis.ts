/**
 * Prompt for SPICED qualification analysis from call transcription.
 * Field names MUST match the custom_fields.field_name values in the database.
 */

const SPICED_FIELDS: Array<{ dbName: string; promptName: string; description: string; maxChars: number }> = [
  {
    dbName: 'S (Situação da Empresa - Operacional)',
    promptName: 'S - Situation',
    maxChars: 800,
    description:
      'Contexto atual do lead: modelo de negócio, estrutura, canais ativos, investimento em marketing, faturamento, ticket, volume, time, momento do negócio, presença digital. Use bullets com hífen (-).',
  },
  {
    dbName: 'P (Problemas Identificados - Prioridade)',
    promptName: 'P - Problem',
    maxChars: 800,
    description:
      'Dores reais identificadas — não superficiais. O que está travando crescimento ou gerando perda. Seja crítico e direto. Use bullets com hífen (-).',
  },
  {
    dbName: 'I (Impacto do problema descoberto)',
    promptName: 'I - Implication',
    maxChars: 800,
    description:
      'Impacto financeiro e operacional das dores. Quantifique sempre que possível com base nos dados da call. Mostre o custo de não resolver. Use bullets com hífen (-).',
  },
  {
    dbName: 'CE (Evento Crítico)',
    promptName: 'C - Critical Event',
    maxChars: 800,
    description:
      'O que motivou a conversa agora. Gatilhos de urgência. Eventos que criam janela de oportunidade. Use bullets com hífen (-).',
  },
  {
    dbName: 'E (Decisão)',
    promptName: 'E - Decision',
    maxChars: 800,
    description:
      'Quem decide, timeline, critérios de decisão, objeções levantadas na call, reunião agendada. Use bullets com hífen (-).',
  },
  {
    dbName: 'D (Qual é o Processo de tomada de decisão)',
    promptName: 'D - Decision Process',
    maxChars: 800,
    description:
      'Como funciona a tomada de decisão, quem influencia, critérios técnicos ou financeiros, prazo mínimo para avaliar resultado. Use bullets com hífen (-).',
  },
  {
    dbName: 'Oportunidades',
    promptName: 'Oportunidades',
    maxChars: 600,
    description:
      'Oportunidades concretas identificadas — canais subutilizados, ativos parados, gaps de mercado, diferenciais competitivos, caminhos de escala. Use bullets com hífen (-).',
  },
  {
    dbName: 'Gaps da ligação',
    promptName: 'Gaps',
    maxChars: 600,
    description:
      'Perguntas que ficaram sem resposta, organizadas por categoria. Estruture exatamente assim:\n\nFinanceiros:\n- pergunta\n\nOperacionais:\n- pergunta\n\nEstratégicos:\n- pergunta\n\nDecision Process:\n- pergunta\n\nSe uma categoria não tiver gaps, escreva "- nenhum".',
  },
  {
    dbName: 'Observação Decisor',
    promptName: 'Observacao',
    maxChars: 300,
    description:
      'Qualquer informação relevante sobre o decisor ou empresa que impacte a negociação (exemplo: decisor tem outra fonte de renda, empresa em reestruturação, ex-cliente, sócios, etc.). Texto livre, conciso. Se não houver nada relevante, retorne "".',
  },
];

/** Known SPICED field names for matching against custom_fields table */
export const SPICED_FIELD_NAMES = SPICED_FIELDS.map((f) => f.dbName);

/** Map from prompt response key → database field name */
const PROMPT_TO_DB = new Map(SPICED_FIELDS.map((f) => [f.promptName, f.dbName]));

export function mapSpicedResponseToDbNames(response: Record<string, string>): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(response)) {
    const dbName = PROMPT_TO_DB.get(key);
    if (dbName && value) {
      mapped[dbName] = value;
    }
  }
  return mapped;
}

/** Lead context passed to the prompt as cabeçalho */
export interface SpicedLeadContext {
  decisorNome?: string | null;
  decisorCargo?: string | null;
  empresa?: string | null;
  cnpj?: string | null;
  segmento?: string | null;
  cidade?: string | null;
  uf?: string | null;
  origem?: string | null;
  site?: string | null;
  instagram?: string | null;
  linkedin?: string | null;
  outrosCanais?: string | null;
}

function formatLeadContext(ctx: SpicedLeadContext | undefined): string {
  if (!ctx) return 'Não fornecido.';
  const parts: string[] = [];
  if (ctx.decisorNome) parts.push(`Decisor: ${ctx.decisorNome}${ctx.decisorCargo ? ` — ${ctx.decisorCargo}` : ''}`);
  if (ctx.empresa) parts.push(`Empresa: ${ctx.empresa}`);
  if (ctx.cnpj) parts.push(`CNPJ: ${ctx.cnpj}`);
  if (ctx.segmento) parts.push(`Segmento: ${ctx.segmento}`);
  const local = [ctx.cidade, ctx.uf].filter(Boolean).join('/');
  if (local) parts.push(`Região: ${local}`);
  if (ctx.origem) parts.push(`Origem do lead: ${ctx.origem}`);
  if (ctx.site) parts.push(`Site: ${ctx.site}`);
  if (ctx.instagram) parts.push(`Instagram: ${ctx.instagram}`);
  if (ctx.linkedin) parts.push(`LinkedIn: ${ctx.linkedin}`);
  if (ctx.outrosCanais) parts.push(`Outros canais: ${ctx.outrosCanais}`);
  return parts.length > 0 ? parts.join('\n') : 'Não fornecido.';
}

export function buildSpicedAnalysisPrompt(
  transcription: string,
  leadContext?: SpicedLeadContext,
): string {
  const fieldDescriptions = SPICED_FIELDS
    .map((f) => `${f.promptName} (máximo ${f.maxChars} caracteres):\n${f.description}`)
    .join('\n\n');

  const jsonKeys = SPICED_FIELDS.map((f) => `"${f.promptName}": "..."`).join(', ');

  return `Você é um especialista sênior em diagnóstico comercial e marketing, com foco em geração de demanda, tráfego pago, funil de vendas e análise estratégica. Sua função é transformar transcrições brutas de ligações de BDR/SDR em uma análise SPICED completa, estruturada e crítica, pronta para ser usada em reuniões comerciais consultivas.

DIRETRIZES DE ANÁLISE
- Foque em diagnóstico, leitura de cenário e identificação de gaps.
- Sempre que possível, quantifique impacto financeiro e operacional com base nos dados fornecidos na call.
- Considere contexto de marketing digital, vendas e escala.
- Identifique inconsistências, riscos e oportunidades ocultas.
- Não suavize problemas — seja preciso e crítico.
- Pense como alguém que está avaliando potencial de escala do negócio.
- Evite generalidades — tudo precisa ser específico e fundamentado no que foi dito na ligação.
- Se houver números (leads, conversão, ticket, CAC, faturamento), explore ao máximo.
- NÃO invente dados, estimativas ou informações que não foram ditas na ligação. Se não foi mencionado, registre na seção Gaps.
- Use apenas o que foi dito na call + as informações de cabeçalho do lead fornecidas.
- Se uma seção não tiver informação suficiente, retorne string vazia "".

REGRAS DE FORMATAÇÃO DENTRO DOS CAMPOS
- Texto puro, SEM markdown.
- NÃO use ##, **, negrito, itálico ou qualquer formatação visual.
- Use apenas hífens (-) para bullets.
- Idioma: SEMPRE português brasileiro.
- Tom profissional, direto, crítico e consultivo.
- RESPEITE o limite máximo de caracteres indicado em cada campo. Seja conciso e direto.
- NÃO use quebras de linha dentro dos valores JSON. Use " - " para separar bullets em uma única linha.

CABEÇALHO DO LEAD
${formatLeadContext(leadContext)}

TRANSCRIÇÃO DA CALL
${transcription}

CAMPOS A PREENCHER

${fieldDescriptions}

FORMATO DE RESPOSTA
Responda APENAS com JSON válido, sem markdown, sem explicações adicionais. Use exatamente as chaves abaixo:
{${jsonKeys}}`;
}
