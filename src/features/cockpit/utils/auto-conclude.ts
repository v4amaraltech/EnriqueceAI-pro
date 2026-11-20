/**
 * Interruptor do "Concluir automático": quando o motor decide, com segurança, que a ligação foi SEM CONVERSA (webhook com
 * `hangup_cause` e lead não atendeu, ou desligamento da escuta ao vivo com marca `auto_hangup` válida), ele pede ao painel do
 * webphone que conclua o cartão "Ligação finalizada" sozinho. `false` volta ao comportamento antigo (o SDR clica em "Concluir").
 */
export const AUTO_CONCLUDE_NO_CONVERSATION = true;
