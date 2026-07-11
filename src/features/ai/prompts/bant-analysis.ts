/**
 * Prompt for BANT qualification analysis from call transcription.
 * Field names MUST match the custom_fields.field_name values in the database.
 *
 * BANT = Budget, Autoridade, Necessidade, Timing. Substitui o antigo SPICED.
 * Mantém 3 campos auxiliares úteis pro closer: Oportunidades, Gaps da ligação,
 * Observação Decisor.
 */

const BANT_FIELDS: Array<{ dbName: string; promptName: string; description: string; maxChars: number }> = [
  {
    dbName: 'B (Budget)',
    promptName: 'B - Budget',
    maxChars: 1200,
    description:
      'O que você entendeu sobre a grana do lead e como ele se comporta com dinheiro. Faturamento, ticket médio, quanto ele já joga em marketing/vendas/tráfego hoje, se tem fôlego ou tá apertado, se topou investir ou travou no preço. Traga a sensação também: ele falou de dinheiro tranquilo ou ficou desconfortável? Achou caro, chorou desconto? Quantifique os números que ele deu.',
  },
  {
    dbName: 'A (Autoridade)',
    promptName: 'A - Autoridade',
    maxChars: 1200,
    description:
      'Quem manda ali e como a decisão anda. Se o contato decide sozinho ou depende de sócio/esposa/conselho, quem mais entra, a alçada dele, e como ele se posiciona (seguro, inseguro, vai ter que "vender pra dentro"). Registre o jeitão do decisor e como ele conduz — ex.: "o Ricardo é bem direto, decide na hora" ou "ele enrola, vai ter que levar pros sócios".',
  },
  {
    dbName: 'N (Necessidade)',
    promptName: 'N - Necessidade',
    maxChars: 1200,
    description:
      'A dor real e o quanto ela aperta. O que ele quer resolver, por que agora, o que tá travando ou doendo, e quanto isso custa pra ele. Traga o emocional: tava ansioso pra resolver? Cansado do problema? Cético de que dá pra melhorar? Empolgado com a possibilidade? Mostre o quanto isso pesa no dia a dia dele.',
  },
  {
    dbName: 'T (Timing)',
    promptName: 'T - Timing',
    maxChars: 1200,
    description:
      'A urgência de verdade. Tem prazo, evento ou gatilho concreto? Ele quer pra ontem ou tá só pesquisando? Você percebeu pressa ou enrolação? Escreve o que te deu a sensação de que é pra já — ou de que vai arrastar. Ex.: "quer resolver antes de abrir a 2ª loja", "me pareceu sem pressa, só cotando".',
  },
  {
    dbName: 'Oportunidades',
    promptName: 'Oportunidades',
    maxChars: 700,
    description:
      'As brechas que você enxergou pra V4 — canais parados, ativos subutilizados, gaps de mercado, diferenciais, coisas que dá pra destravar rápido. Escreve como quem já viu onde tem dinheiro na mesa.',
  },
  {
    dbName: 'Gaps da ligação',
    promptName: 'Gaps',
    maxChars: 700,
    description:
      'O que ficou faltando descobrir na call, pro closer puxar na reunião. Organize por categoria, exatamente assim:\n\nFinanceiros:\n- pergunta\n\nOperacionais:\n- pergunta\n\nEstratégicos:\n- pergunta\n\nDecision Process:\n- pergunta\n\nSe uma categoria não tiver gaps, escreva "- nenhum".',
  },
  {
    dbName: 'Observação Decisor',
    promptName: 'Observacao',
    maxChars: 500,
    description:
      'O resumo do seu "feeling": tudo que você sentiu sobre o decisor e a empresa que ajuda o closer a se preparar — personalidade, estilo de comunicação, clima da conversa, química, red flags, o que fez ele engajar ou travar. Ex.: "cara gente boa, mas ansioso", "senti ele meio desgostoso do próprio negócio", "super técnico, vai querer número". Se não houver nada relevante, retorne "".',
  },
];

/** Known BANT field names for matching against custom_fields table */
export const BANT_FIELD_NAMES = BANT_FIELDS.map((f) => f.dbName);

/** Map from prompt response key → database field name */
const PROMPT_TO_DB = new Map(BANT_FIELDS.map((f) => [f.promptName, f.dbName]));

export function mapBantResponseToDbNames(response: Record<string, string>): Record<string, string> {
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
export interface BantLeadContext {
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

function formatLeadContext(ctx: BantLeadContext | undefined): string {
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

export function buildBantAnalysisPrompt(
  transcription: string,
  leadContext?: BantLeadContext,
): string {
  const fieldDescriptions = BANT_FIELDS
    .map((f) => `${f.promptName} (máximo ${f.maxChars} caracteres):\n${f.description}`)
    .join('\n\n');

  const jsonKeys = BANT_FIELDS.map((f) => `"${f.promptName}": "..."`).join(', ');

  return `Você é o próprio SDR que acabou de sair desta ligação e está escrevendo, do seu jeito, as anotações para entregar ao closer que vai conduzir a reunião. O closer NÃO participou da call — as suas anotações são os olhos e ouvidos dele. Escreva como um vendedor experiente contaria pro colega antes de passar o bastão.

COMO ESCREVER (o mais importante)
- Escreva como GENTE de verdade, na primeira pessoa: "senti que...", "o cara...", "ela deixou claro que...", "achei que...". NADA de cara de relatório ou de texto de IA.
- Evite jargão corporativo, frases genéricas e aquele tom robótico. Se soar como um vendedor humano anotando na correria, tá certo.
- Vá ALÉM dos dados: capte o lado humano da conversa — o humor e o estado do lead (ansioso, empolgado, desconfiado, desanimado, cético, com pressa, cansado do problema), a personalidade e o estilo dele (direto, prolixo, técnico, informal, mandão, inseguro), o nível de interesse, a química da conversa, o tom das objeções, o que fez ele abrir ou travar. Ex.: "o Ricardo é bem direto, não gosta de rodeios", "senti o lead meio desgostoso do próprio negócio", "ela tava ansiosa pra resolver isso ontem".
- Seja DETALHADO. Não economize: traga o contexto e os detalhes que fazem o closer "já conhecer" o lead antes de entrar na reunião.

REGRAS DE HONESTIDADE
- Seja honesto e crítico. Não suavize. Se o lead é fraco ou tem red flag, diga com todas as letras.
- NÃO invente nada. Use SÓ o que foi dito na call + o cabeçalho do lead. O que não apareceu, jogue em "Gaps". Se um campo não teve informação, retorne string vazia "".
- Quantifique os números que o lead deu (faturamento, ticket, verba, prazos, conversão).

FORMATAÇÃO
- Português brasileiro, tom de anotação de vendedor.
- Texto puro, SEM markdown — nada de #, *, negrito, títulos. Pode escrever em frases corridas, do jeito que sairia numa anotação de verdade; use hífen (-) pra listar quando fizer sentido, mas não force bullets.
- RESPEITE o limite máximo de caracteres de cada campo.
- Não use quebras de linha soltas dentro dos valores JSON; escreva contínuo (separe ideias com ". " ou " - ").

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
