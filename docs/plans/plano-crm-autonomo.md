# Plano do CRM autônomo (EnriqueceAI)

Atualizado em 15/11/2026 (BRT).

## Objetivo

O SDR de pré-vendas só faz ligações, em volume, com discador automático serial (uma ligação por vez por SDR). O sistema cuida do resto:

1. Orquestra qual é o melhor lead para ligar agora, com base nos sinais (respostas de e-mail e WhatsApp, abertura, cliques, no-show, cadência vencida).
2. Envia sozinho os toques de e-mail e WhatsApp da cadência.
3. Mostra no painel lateral o contexto completo do lead durante a ligação.
4. Registra o resultado da ligação no CRM automaticamente (atendeu, não atendeu, caixa postal), com sugestão de próxima atividade que o SDR confirma.

## Regras gerais

- Toda funcionalidade nova entra atrás de flag, liberada só para a V4 via `allow_org_ids`, nunca com `enabled=true` global.
- Migration é aplicada antes do merge, porque o merge publica em produção automaticamente.
- Nada de ligação real, envio, alteração em produção, flag, cron ou segredo sem aprovação explícita.
- Histórico é append-only. Linhas concluídas em `call_transcripts_v2` e `call_qualifications` não são alteradas.
- `live_amd` continua só em modo sombra.

## O que já está em produção (commit 268c74b, health 200)

| Entrega | PR | Flag (V4 via allow_org_ids) |
|---|---|---|
| Cartão completo do lead no painel do Power Dialer | [#620](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/620) | `call_lead_card_v1` |
| Dedupe e filtro de auto-resposta das respostas de e-mail | [#621](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/621) | sem flag (índice único) |
| Fila do discador ordenada por prioridade de sinais e atualizada durante a sessão | [#622](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/622) | `call_priority_v2` |
| Captura de resposta do WhatsApp, pausa a cadência | [#624](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/624) | `whatsapp_reply_capture_enabled` |
| E-mail automático na cadência standard (mista) | [#626](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/626) | `cadence_mixed_auto_email_v1` |
| Atualização automática do CRM pelo resultado da ligação | anteriores | `crm_auto_update_v1`, `crm_auto_update_v1_live` |
| Motor de transcrição e detecção de caixa postal | anteriores | `call_transcription_engine_v1`, `webphone_live_amd`, `webphone_voicemail_autohangup` |

## Como funciona a prioridade da fila (call_priority_v2)

Ordem de prioridade:

1. Resposta por e-mail ou WhatsApp nos últimos 7 dias.
2. No-show nos últimos 14 dias.
3. Abertura ou clique de e-mail nos últimos 7 dias.
4. Cadência mais vencida.
5. Recência.

A fila se atualiza a cada 30s ou na hora, sem trocar o lead que está em ligação. Continuam valendo: etapa atual precisa ser de ligação, limite diário, intervalo de 1h entre tentativas no mesmo lead, 5s entre tentativas e discagem serial.

## Regras de classificação das ligações

- `NUMBER_CHANGED`, `SUBSCRIBER_ABSENT` e a mensagem da operadora "fora de área ou indisponível" aparecem como "Fora de área". No CRM ficam como `no_answer`.
- Número inexistente (`UNALLOCATED_NUMBER` e similares) vira `technical_failure` ("Falha técnica").
- Ligação atendida com menos de 30s aparece como "Provável caixa postal", com Caixa postal pré-selecionada.

## Janelas dos crons

- `execute-cadence-steps`: a cada 5 min, seg a sex, das 08:00 às 17:59 BRT.
- `process-whatsapp-queue`: a cada minuto, mesma janela, pela instância do responsável do lead.
- Checagem de respostas de e-mail: a cada 10 min.

## Teste ponta a ponta (segunda-feira, a partir das 09:00 BRT)

Cadência de teste: `ae4e22bd` "TESTE Mercante Net - ciclo SDR" (standard, em rascunho). Etapas sem espera: 1 e-mail, 2 WhatsApp automático, 3 ligação.

Lead: Mercante Net (`969ea854`), responsável Vinicius, e-mail saindo por vinicius.mercante@v4company.com.

Roteiro:

1. Lead entra na cadência.
2. E-mail sai automaticamente.
3. WhatsApp sai automaticamente.
4. Vinicius responde os dois.
5. Respostas registradas como `replied` e cadência pausada.
6. Lead sobe para o topo do Power Dialer como o próximo a ligar.
7. Atividade de ligação aparece, com o cartão do lead no painel.
8. Após a ligação, resultado gravado automaticamente no CRM.

Pré-requisitos:

- [ ] Vinicius reconectar o WhatsApp no Enriquece (instância em erro desde 15/11 00:12).
- [ ] Ok do Vinicius para ativar a cadência e inscrever o lead.

## Pendências

- Reconectar a caixa Gmail da V4 (Matheus) em erro desde 12/11.
- Limpar as 517 linhas `replied` antigas duplicadas (precisa de ok separado; não afetam mais a prioridade).
- Teste de caixa postal do PR619 (precisa de autorização de ligação).
- PR615: migration, merge e dry-run.
- Opcionais: registrar a atividade sozinho, limite de duração máxima, "Fora de área" na timeline e nas estatísticas, reduzir ligações sem `lead_id`.

## Próximos passos depois do teste

1. Validar os números do teste e ajustar o que falhar.
2. Ampliar o uso para os SDRs da V4 mantendo o gate por `allow_org_ids`.
3. Medir volume de ligações por SDR, taxa de conexão e acerto da classificação automática.
