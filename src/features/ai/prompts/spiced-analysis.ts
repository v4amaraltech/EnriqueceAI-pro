/**
 * Prompt for SPICED qualification analysis from call transcription.
 */

const SPICED_FIELD_DESCRIPTIONS: Record<string, string> = {
  'Situação': 'Contexto atual do prospect. Como operam hoje? Qual a equipe? Quais ferramentas usam? Qual o modelo de negócio?',
  'Problemas': 'Dores e desafios mencionados. O que não funciona bem? Onde perdem tempo/dinheiro? Quais frustrações?',
  'Impacto': 'Consequências dos problemas. Quanto custa não resolver? Impacto nos resultados, equipe, clientes?',
  'Evento Crítico': 'O que motivou a busca por solução agora? Mudança de liderança? Nova meta? Prazo? Perda de cliente?',
  'Processo de Decisão': 'Quem decide? Quantas pessoas envolvidas? Orçamento disponível? Timeline? Próximos passos?',
};

/** Known SPICED field names for matching against custom_fields table */
export const SPICED_FIELD_NAMES = Object.keys(SPICED_FIELD_DESCRIPTIONS);

export function buildSpicedAnalysisPrompt(transcription: string): string {
  const fieldDescriptions = Object.entries(SPICED_FIELD_DESCRIPTIONS)
    .map(([name, desc]) => `- ${name}: ${desc}`)
    .join('\n');

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
{"Situação": "...", "Problemas": "...", "Impacto": "...", "Evento Crítico": "...", "Processo de Decisão": "..."}`;
}
