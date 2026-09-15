# 2026-09-14 — "Não é WhatsApp" pausa a cadência (achado no acompanhamento do Perdido no fim da cadência)

## Origem
Continuação da sessão de 11/set (`2026-09-11-perdido-nunca-respondeu-fim-de-cadencia.md`). A regra "fim da cadência → Perdido" entrou no ar em 11/set 10:03 UTC; o Vini pediu acompanhamento. Foram 4 conferências só de leitura (11/set 11h, 14h37 e 19h10; 14/set 11h37 e 19h52 BRT).

## Acompanhamento da regra — sem nenhuma falha

| Dia | Fins de cadência | Resultado |
|---|---|---|
| 11/set | 21 Recovery + 1 (Matheus) | 22 Perdidos "Deixou de responder" ✅ |
| 11/set | 6 "Inbound — E-mail (auto)" | ficaram: têm a Inbound 2.0 aberta ✅ |
| 14/set | 9 "Inbound — E-mail (auto)" + 1 Recovery | ficaram: outra cadência aberta / retorno pendente ✅ |

- Nenhum motivo errado, nenhum lead deixado para trás, nenhum inbound perdido por "Nunca respondeu" (a Recovery automática ainda não foi exercitada).
- O pico temido não veio: esperávamos até ~240 no dia 11 (240 enrollments no passo 7 da Recovery, 169 vencendo) e saíram 22. O passo 7 oscila em ~230 porque outros vão chegando do passo 6.
- Conferências automáticas agendadas por cron de sessão (11h/14h/17h BRT, dias úteis, expira em 7 dias) — morrem com a sessão.

## O furo achado: botão "Não é WhatsApp"

Em 14/set apareceu 1 lead em "Contatado sem cadência" **sem rastro na timeline**. Causa: `report-whatsapp-invalid.ts` **encerrava** o enrollment (`status='completed'`) quando não sobrava passo de outro canal. Como esse caminho não grava `cadence_completed`, escapava também da regra nova.

Contrariava o AC 5 da story `activity-skip-guardrails` ("a cadência avança"). Vini: *"esse botão não era para remover o lead da cadência"*.

**Escala:** 11 enrollments encerrados assim desde jun/2026 (2 jun, 4 jul, 1 ago, 4 set); 2 em limbo no dia.

### Correção (PR [#418](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/418), squash `0b1d782e`, no ar 22:52 UTC)
- Havendo passo de outro canal: avança (inalterado). Não havendo: **`paused`**, nunca `completed`.
- Pausa grava `cadence_paused` (`metadata.reason='whatsapp_invalid'`) e notifica o dono do lead com o que fazer.
- 6 testes novos; typecheck ✅ lint ✅ 2082 testes ✅ build ✅; CI verde de primeira.
- Story `whatsapp-invalid-keeps-enrollment`; docs no PR [#419](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/419) (`549c5627`).

**Por que pausar e não deixar ativa:** `fetch-pending-activities.ts` esconde passos de WhatsApp de lead com `whatsapp_invalid_at`. Enrollment `active` num passo de WhatsApp desaparece da fila em silêncio — o mesmo limbo com outra roupa.

### Dados corrigidos
- Os 2 leads em limbo voltaram para `paused` (`completed_at` nulo) + evento na timeline. Backup `_bkp_wa_invalid_reopen_20260914`.
- Enrollment `b6e644b6` (lead `a6e29be5` "AbaIncêndio", João Fogaça) estava em `current_step = 10` numa cadência de 7 passos (sobra de edição da Recovery). A pedido do Vini foi para o **passo 6** (ligação, nunca feita) e **reativado**, vencendo 15/set 9h. O passo 7 foi descartado: é WhatsApp e o lead está sem WhatsApp.

## Manutenção do checkout principal
- 11/set: o índice estava idêntico à tree de um commit antigo (`491e83a2`) porque o ref `main` avançou sem atualizar índice/arquivos — provavelmente outra sessão via worktree. Resolvido com `git checkout HEAD -- <29 paths>` + `merge --ff-only`.
- 8 handoffs de agosto que nunca tinham sido commitados foram para o `main` (PR #400).
- 14/set: 1 commit local de outra sessão, com conteúdo idêntico ao já mesclado pelo #417 — descartado com `reset --hard` após o Vini autorizar.

## ⭐ Lições
- ⚠️ **`git reset --hard` levou junto o WIP não commitado** (`create-checkout.ts`, Price de catálogo da Stripe). Havia backup feito no passo anterior e o arquivo foi restaurado igual, mas o certo era preservar o WIP antes (stash com tag ou commit temporário). **Nunca usar `reset --hard` num checkout com mudanças não commitadas.**
- ⭐ Mudar `current_step`/`status` de um enrollment dispara o trigger `calculate_next_step_due`, que aplica o `delay_days` do passo (os 6 dias jogaram o vencimento para 21/09). Para forçar uma data, `UPDATE` só em `next_step_due` — o trigger é `OF current_step, status`.
- ⭐ Enrollment `paused` não é alcançado pelo auto-perda (cron olha `active`/`completed`) nem pelo alerta de limbo. Hoje são ~2 leads/mês; se acumular, vira story.
- ⭐ O CI caiu 3× no flaky "Closing rpc while fetch was pending" (`inbound-lead.service.test.ts`) com os testes todos verdes. `gh run rerun <id> --failed` resolve. Vale uma story para matar o flaky.
- ⭐ Ao testar em prod pela fila, depois do "Enviado manualmente" a tela pula sozinha para o próximo lead **real** — fechar antes de clicar em qualquer coisa.

## Próximos passos
- Enviar o aviso ao gestor (rascunho no Gmail do Vini, "Para" em branco): a taxa de perda "Nunca respondeu" sobe já em setembro.
- Seguir o acompanhamento; a Recovery automática de inbound ainda não foi exercitada.
- Opcional: story para o flaky do CI e para o motor pular passos de WhatsApp de lead marcado.
