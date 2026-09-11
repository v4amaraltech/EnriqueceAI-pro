# Handoff — Efetividade das ligações + aviso API4COM do Julio Cesar

**Data:** 10/09/2026
**Pedido de origem (Vini):** "praticamente tudo aparece como Não Conectada; como mostrar quantas ligações tiveram conversa relevante?" — print da tela Estatísticas › Ligações da org **V4 Company Julio Cesar** (01–10/set: 1.023 ligações, 8h15, ~100% "Não Conectada").
**Estado final (atualizado 11/09 00h15 BRT):** tudo mergeado e no ar (`/api/version` = `2ece7b1`). Falta a conferência de 11/set 10h (agendada) e reinstalar as integrações de CRM sobrescritas (seção 6).

---

## 1. O que foi entregue (6 PRs, todos no ar)

| PR | Squash | O que faz |
|---|---|---|
| [#375](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/375) | `305669ea` | Tela nova de Ligações: cards (Conversas relevantes · Taxa de conexão · Sem desfecho), funil **Discadas → Atendidas → Conversa relevante**, tabela **Resultado das ligações** (desfecho do SDR) e **Efetividade por SDR**. Rota de diagnóstico `POST /api/admin/check-api4com-config` passa a mostrar a config da integração. |
| [#377](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/377) | `7983390a` | Webhook API4COM e worker `back-associate` descobrem a org pelo **domínio da conta** (`payload.domain` × `api4com_connections.sip_domain`), não pelo ramal. |
| [#378](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/378) | `56826eda` | Rota `POST /api/admin/configure-api4com-call-webhook` (dryRun padrão) que cria/atualiza SÓ a integração `webhook` de uma org. |
| [#379](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/379) | `c8c3649e` | Tela lê **todas** as ligações do período (`lib/supabase/fetch-all-rows.ts`; antes `.limit(10000)`); "Sem desfecho" só cobra ligação do discador + linha "Feita fora do discador"; funil sem texto encavalado. |
| [#381](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/381) | `f093d0e4` | Este handoff (versão inicial). |
| [#382](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/382) | `2ece7b1e` | Cron `reregister-api4com-webhooks` e cadastro de ramal **param de sobrescrever a integração do CRM** — ver seção 6. |

Stories: `docs/stories/call-effectiveness-view.story.md` e `docs/stories/api4com-webhook-org-by-domain.story.md` (ambas Ready for Review — quality gate @architect não rodado).

### Regras novas (módulos puros)
- `features/calls/effectiveness.ts`
  - **Atendida** = `isConnectedCall()` **ou** SDR marcou `relevant_conversation` / `answered_no_progress` / `callback_requested`. Caixa postal nunca conta.
  - **Conversa relevante** = SDR marcou `relevant_conversation`.
  - **`isDialerCall`** = `metadata.gateway` `flux-*` (discador API4COM) ou `origin = 'whatsapp'`.
  - **Taxa de conexão** continua `isConnectedCall()` puro → paridade com Painel de Ligações e BI.
- `features/integrations/services/api4com-org-scope.ts` — escopo de org pelo domínio; domínio desconhecido nunca cai em org já mapeada; ramal ambíguo → não cria ligação.
- `features/integrations/services/api4com-call-webhook.ts` — planeja create/update/noop da integração `webhook` (rota admin) e **`planCallWebhookRepair`** (cron e cadastro de ramal: cria se faltar, liga/tira filtro, **nunca troca URL existente**, nunca toca outra integração).
- `lib/supabase/fetch-all-rows.ts` — paginação compartilhada (avança pelo que chegou; ordem determinística obrigatória).

---

## 2. Causa raiz do "tudo Não Conectada" (Julio Cesar)

1. A integração que o cron `reregister-api4com-webhooks` configura (a **primeira** da conta: sippulse/amocrm/salesforce…) tem **filtro de gateway**, e o discador manda `gateway: flux-{orgId}` → a API4COM filtra todas as ligações. Vale para **os 10 ramais das duas orgs** — esse caminho direto nunca funcionou para ninguém.
2. O que funciona na Amaral é **outra** integração, gateway `webhook`, **sem filtro**, apontando para o n8n `webhook-n8n.v4companyamaral.com/webhook/api4com-call-event` (repassa para nós).
3. No Julio: o ramal 1025 tinha essa integração com a URL do **editor** do n8n (`n8n.v4companyamaral.com/workflow/…`); a credencial do 1023/1000 não tinha.
4. Contas separadas confirmadas: **Julio = `mendezco.api4com.com`**, **Amaral = `v4amaral.api4com.com`**. Ramais **1024 e 1028 existem nas duas** → daí o PR #377 antes de ligar o aviso.

---

## 3. Mudanças feitas em produção (fora do código)

| Quando (UTC) | O quê | Como reverter |
|---|---|---|
| 10/set 18:19 | Rodado 1x o cron `reregister-api4com-webhooks` (jobid 57) — 10/10 `success`, igual ao que já roda todo dia | — |
| 10/set 22:35 | `api4com_connections.sip_domain = 'mendezco.api4com.com'` nos ramais 1000/1023/1025 do Julio (antes: vazio) | voltar para `NULL` |
| 10/set ~23:10 | API4COM do Julio: **criada** integração `webhook` id **164043** (credencial 1000/1023); **atualizada** a **163813** (1025: URL do editor → URL do webhook do n8n, v1.8 → v1.4). `verified: true`; sippulse e mars-voip intactas | PATCH na 163813 com a URL antiga / desligar a 164043 |

| 11/set 03:13 | Simulação (`dryRun: true`) do cron corrigido — **nada alterado** | — |
| 11/set 05:23 (previsto) | Rodada automática do cron corrigido: **cria** a integração `webhook` do Amaral 1040 | desligar a integração criada no 1040 |

Todas autorizadas pelo Vini no chat, uma a uma.

---

## 4. Precisão da tela (medido em 10/set)

| Número | Situação |
|---|---|
| Total / Duração | ✅ bate com a telefonia (rediscagens contam — tentativas reais, ~31s depois; sem duplicatas) |
| Taxa de conexão — Amaral | ✅ regra oficial |
| Taxa de conexão — Julio | ❌ 0% em 01–10/set e **continua assim para esse período** (a consulta da API4COM não informa `answered_at`). Só as ligações novas, com o aviso ligado, passam a contar. |
| Atendidas / Relevantes | ⚠️ dependem do SDR marcar o desfecho: 47% (Amaral) e 63% (Julio) das ligações do discador ficam sem desfecho |
| Sem desfecho | ✅ corrigido no #379 (antes misturava ligações feitas fora do discador) |
| Períodos ≥30 dias (Amaral) | ✅ corrigido no #379 (antes cortava em 10.000) |

---

## 5. Pendências

1. ⏳ **Conferência agendada 11/set 10h** (scheduled task `conferencia-webhook-api4com-julio`, só leitura): eventos `mendezco` chegando e caindo no Julio, Amaral seguindo `processed` com o código novo, **nenhum evento na org errada**. O app do Claude precisa estar aberto.
2. **Outras 10 telas de estatística** ainda com `.limit(10000)` (atividades, cadências, desempenho, e-mail, motivos de perda, painel de ligações, export CSV com 5.000) — tarefa separada já iniciada pelo Vini em outra sessão.
3. ~~Cron `reregister-api4com-webhooks` sobrescreve a integração do CRM~~ → **corrigido no #382** (seção 6). Resta **reinstalar/revalidar no painel da API4COM** as integrações já sobrescritas: **Kommo (ramal 1024)** e **Salesforce (ramal 1033)** — URL original perdida.
4. **Desfecho obrigatório no discador** (item 3 original) — não aprovado ainda; é o que falta para "Conversa relevante" ficar completa.
5. `CallOutcomeBarChart.tsx` ficou sem uso (não apagado — decisão do Vini).
6. Quality gate (@architect) das duas stories não rodado.
7. Ligações do Julio de 0s feitas antes do aviso: o `cleanup-ghost-calls` apagava tentativas `flux-*` sem aviso e com duração 0 após 6h. Com o reconcile corrigido (#374/#376, outra sessão) e o aviso ligado, deve parar — confirmar junto com o item 1.

---

## 6. Cron `reregister` sobrescrevia a integração do CRM (corrigido — #382)

**O problema.** Desde **15/mai** (cadastro de ramal, `registerWebhook`) e **todo dia desde 12/ago** (cron `reregister-api4com-webhooks`, pg_cron **jobid 57**, 05:23 UTC = 02:23 BRT), o sistema fazia `PATCH` na **primeira** integração da conta API4COM, trocando a `webhookUrl` dela pela nossa + filtro de gateway. E nem funcionava para nós (o filtro barrava o gateway `flux-{orgId}` do discador).

| Integração sobrescrita | Ramais | Consequência provável |
|---|---|---|
| **amoCRM (Kommo)** | 1024 | eventos de ligação deixam de ir para o Kommo |
| **Salesforce** (franqueadora) | 1033 | idem para o Salesforce |
| enriqueceai | 1014 | — (nossa) |
| sippulse (telefone da API4COM) | 1040, 1042, 1028, 1045, 1000/1023/1025 | eventos do webphone vinham para nós em duplicidade (deduplicados) |

**A correção (#382).** Cron e cadastro de ramal passam a usar `planCallWebhookRepair` (só a integração gateway `webhook`, sem filtro). `registerWebhook` virou `ensureCallWebhook(userId)`. A rota do cron ganhou `dryRun` e `orgId`.

**Simulação em prod (11/09 03:13 UTC, `dryRun: true`, nada alterado):** 10 ramais, 0 erros.
- **`create` só no Amaral 1040** (única credencial sem integração `webhook`) → acontece na rodada de 02:23 BRT de 11/set.
- Demais `noop`; Julio 1023 `skip` (mesma credencial do 1000).
- Aviso informativo no **Amaral 1024**: a integração `webhook` aponta para URL um pouco diferente da padrão, mas os eventos chegam normalmente (598 hangups em set) — o cron não mexe.

**O que NÃO foi feito:** restaurar as integrações de CRM já sobrescritas. A URL original é desconhecida → alguém precisa **reinstalar/revalidar no painel da API4COM** as de **Kommo (1024)** e **Salesforce (1033)**. Se as ligações da API4COM não aparecem no Kommo/Salesforce desde maio, é isso.

**Conferir amanhã (junto da conferência das 10h):** resultado da rodada das 02:23 em `net._http_response` (retém ~6h) ou rodar de novo com `dryRun: true` — o 1040 tem que aparecer como `noop`.

---

## 7. Lições

- ⭐ **Não confiar no "registrado com sucesso" da API4COM:** o PATCH respondia `success` e o aviso nunca chegava. O que resolveu foi **ler a config de volta** (rota de diagnóstico) e comparar com a conta que funciona.
- ⭐ **Ramal não identifica org** quando cada unidade tem a própria conta API4COM — usar o `domain` do evento.
- ⭐ **`.limit(N)` no PostgREST corta em silêncio** — conferir `content-range` e usar `fetchAllRows`.
- CI: o erro "Closing rpc while fetch was pending" é intermitente e aparece também localmente; re-rodar o job resolve.
- A chave `TOKEN_ENCRYPTION_KEY` local não é a de produção → operações na API4COM do cliente só via rota admin em prod.
- ⭐ **Nunca mexer em integração de terceiro na conta do cliente** (CRM, webphone): cada integração tem dono. A nossa é só a gateway `webhook`.
- ⭐ **Não simular em rota antiga:** antes do deploy, a rota do cron não tinha `dryRun` — chamar com `dryRun: true` teria APLICADO a sobrescrita. Sempre confirmar o commit em `/api/version` antes.
