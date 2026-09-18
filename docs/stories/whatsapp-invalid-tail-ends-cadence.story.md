# Story: Cauda de WhatsApp em lead sem WhatsApp = fim de cadência

## Status
Draft

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-18 | Vini + Claude | Story criada. Sobra da story `engine-skips-whatsapp-invalid-steps`: 130 inscrições da Recovery ficaram no último passo (WhatsApp) sem canal para onde ir. Decisão do Vini: tratar como fim de cadência (reusar a regra de Perdido), não "Contatos inválidos". |

## Origem

Em 18/set, a story `engine-skips-whatsapp-invalid-steps` passou a avançar inscrições paradas em passo de WhatsApp de lead marcado com `whatsapp_invalid_at`. Ela **só avança**: quando não sobra passo de outro canal, deixa como está — de propósito, para não criar uma pilha de pausadas invisíveis.

Isso deixou **130 inscrições ativas da Recovery** paradas, e o perfil delas é claro:

| Característica | Número |
|---|---|
| Total | 130 (todas Recovery) |
| No **último** passo da cadência (passo 7, WhatsApp) | 130 |
| Com telefone | 130 |
| Com e-mail | 113 |
| Toques reais (média) | 3,3 |
| Vencidas desde | 11/09 |

Ou seja: **percorreram a régua inteira sem responder** e o único passo restante é impossível de executar. Não é caso de "Contatos inválidos" (o telefone funciona) — é o mesmo caso que a story `cadence-end-immediate-loss` já resolve para quem termina a cadência.

## Story

**As a** gestor de SDRs,
**I want** que a inscrição cuja cauda é só WhatsApp (em lead sem WhatsApp) seja tratada como cadência concluída,
**so that** o lead receba o motivo de perda certo em vez de ficar parado num passo que ninguém consegue executar.

## Acceptance Criteria

1. **Fim de cadência.** Dada inscrição ativa de lead com `whatsapp_invalid_at`, no passo atual de WhatsApp, **sem nenhum passo posterior de outro canal**, quando o motor roda, então a inscrição é encerrada (`completed`) e passa por `markLeadLostOnCadenceEnd`.
2. **Motivo certo por cadência.** Na Recovery o motivo é "Deixou de responder"; nas outras, "Nunca respondeu" (regra existente `pickCadenceEndLossReasonName`).
3. **Proteções mantidas.** Não perde lead que respondeu/tem reunião/ganhou, que tem outra cadência aberta ou retorno agendado — as mesmas guardas de `markLeadLostOnCadenceEnd`.
4. **Rastro.** Grava `cadence_completed` (mensagem deixando claro que o fim veio da cauda de WhatsApp) antes do evento de perda, para a timeline contar a história.
5. **Só a cauda.** Se existe passo posterior de outro canal, o comportamento segue o da story anterior (avança, não encerra).
6. **Teto e tolerância a erro** iguais aos do pré-passo atual: no máximo 50 por execução, falha loga e segue.
7. **Coerência do botão "Não é WhatsApp".** `reportWhatsAppInvalid` hoje **pausa** nesse mesmo cenário (story `whatsapp-invalid-keeps-enrollment`). Alinhar: cauda de WhatsApp no fim da cadência → mesmo tratamento do AC 1. Pausa fica só para o caso de a cadência ainda ter passos de outro canal à frente que o motor não consiga usar.

## Scope

**IN:** pré-passo do motor (`whatsapp-invalid-skip.service.ts`) ganhando o encerramento; alinhamento do `report-whatsapp-invalid.ts`; testes; drenagem dos 130 pelo próprio motor.

**OUT:** mudança na fila; auto-perda de inscrições `paused` (22 em 18/set, das quais 11 vieram do botão); recorte/alerta na tela para leads sem WhatsApp.

## Tasks

- [ ] Estender `skipWhatsAppStepsForInvalidLeads`: sem passo de outro canal → `completed` + `markLeadLostOnCadenceEnd`
- [ ] Evento `cadence_completed` com mensagem própria ("só restavam passos de WhatsApp e o lead está sem WhatsApp")
- [ ] Alinhar `report-whatsapp-invalid.ts` (AC 7)
- [ ] Testes (cauda encerra, meio avança, proteções, teto, erro)
- [ ] Conferir em prod: esperado ~130 Perdidos "Deixou de responder" nas primeiras execuções — **avisar o gestor antes**, a taxa de perda da Recovery vai subir no dia

## Risks

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| 130 perdas de uma vez distorcem o gráfico do mês | Alta | Médio | avisar o gestor antes do deploy; se preferir, drenar com teto menor por dia |
| Lead com telefone bom perdido "por WhatsApp" | Média | Médio | AC 2 usa o motivo de não-resposta, não "Contatos inválidos"; o lead já levou 3,3 toques em média e ainda volta pela Recovery se for inbound |
| Divergência entre motor e botão | Média | Baixo | AC 7 alinha os dois no mesmo ciclo |

## Dependencies

- `cadence-end-immediate-loss` (PR #390) — `markLeadLostOnCadenceEnd` e `pickCadenceEndLossReasonName`.
- `engine-skips-whatsapp-invalid-steps` (PR #429) — o pré-passo que esta story estende.
- `whatsapp-invalid-keeps-enrollment` (PR #418) — o comportamento do botão que o AC 7 alinha.

## Dev Agent Record
_(a preencher)_

## QA Results
_(pendente)_
