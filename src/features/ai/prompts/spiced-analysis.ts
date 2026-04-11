/**
 * Prompt for SPICED qualification analysis from call transcription.
 * Field names MUST match the custom_fields.field_name values in the database.
 */

const SPICED_FIELDS: Array<{ dbName: string; promptName: string; description: string }> = [
  {
    dbName: 'S (Situação da Empresa - Operacional)',
    promptName: 'S - Situação',
    description: 'Contexto atual do prospect. Como operam hoje? Qual a equipe? Quais ferramentas usam? Qual o modelo de negócio?',
  },
  {
    dbName: 'P (Problemas Identificados - Prioridade)',
    promptName: 'P - Problemas',
    description: 'Dores e desafios mencionados. O que não funciona bem? Onde perdem tempo/dinheiro? Quais frustrações?',
  },
  {
    dbName: 'I (Impacto do problema descoberto)',
    promptName: 'I - Impacto',
    description: 'Consequências dos problemas. Quanto custa não resolver? Impacto nos resultados, equipe, clientes?',
  },
  {
    dbName: 'CE (Evento Crítico)',
    promptName: 'CE - Evento Crítico',
    description: 'O que motivou a busca por solução agora? Mudança de liderança? Nova meta? Prazo? Perda de cliente?',
  },
  {
    dbName: 'D (Qual é o Processo de tomada de decisão)',
    promptName: 'D - Processo de Decisão',
    description: 'Quem decide? Quantas pessoas envolvidas? Orçamento disponível? Timeline? Próximos passos?',
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

export function buildSpicedAnalysisPrompt(transcription: string): string {
  const fieldDescriptions = SPICED_FIELDS
    .map((f) => `- ${f.promptName}: ${f.description}`)
    .join('\n');

  const jsonKeys = SPICED_FIELDS.map((f) => `"${f.promptName}": "..."`).join(', ');

  return `Você é um analista de vendas B2B especializado na metodologia SPICED.

Analise a transcrição da ligação de vendas abaixo e extraia informações relevantes para cada campo SPICED.
Para cada campo, escreva um resumo conciso (2-4 frases) baseado APENAS no que foi dito na ligação.
Se a informação para um campo não foi discutida na conversa, retorne string vazia "".
NÃO invente informações que não estão na transcrição.

## Campos SPICED:
${fieldDescriptions}

## Transcrição da ligação:
${transcription}

## Formato de Resposta:
Responda APENAS com JSON válido, sem markdown, sem explicações adicionais:
{${jsonKeys}}`;
}
