# Story: Efetividade das ligações na tela Estatísticas › Ligações

## Status
Ready for Review

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-10 | @dev (Dex) | **Precisão da tela (itens 1 e 2 aprovados pelo Vini):** (1) **teto de 10.000 linhas removido** — a consulta tinha `.limit(10000)` e a V4 Amaral faz 10–11 mil ligações/mês → períodos ≥30 dias mostravam um subconjunto arbitrário. Novo `lib/supabase/fetch-all-rows.ts` (páginas de 5.000, avança pelo que chegou, ordem `started_at,id`, teto de segurança 200 mil com aviso na tela). Implementado por **paginação**, não por agregação em SQL como eu tinha dito, para manter as regras de conexão/atendida num lugar só (TS). Conferido contra prod: agosto/Amaral = 10.578/10.578 linhas, 0 repetidas. (2) **"Sem desfecho" separado**: só cobra ligação do discador (`isDialerCall`: gateway `flux-*` ou WhatsApp); feitas fora (Callface, softphone/Kommo, reconcile) viram linha própria "Feita fora do discador". Taxa sobre as ligações do discador. |
| 2026-09-10 | @dev (Dex) | **PR #375 mergeado** 20:29 UTC (squash `305669ea`), com autorização do Vini. 1ª rodada de CI caiu no flaky conhecido ("Closing rpc while fetch was pending", 238/238 arquivos de teste OK); após `update-branch` com #374/#376 o CI passou. Quality gate (@architect) ainda não rodado. |
| 2026-09-10 | @dev (Dex) | **Diagnóstico API4COM (opção 1 aprovada pelo Vini):** `/api/admin/check-api4com-config` passa a devolver, por ramal, o resumo da integração (gateway, webhook ligado, gateway do filtro, host/path do webhook, tipos, versão) + `dialerPassesConstraint` (o filtro deixa passar `flux-{orgId}`?) + gateway gravado nas 5 últimas ligações. Body opcional `{orgId}`. Só leitura; nunca devolve api key nem token. Helper puro `api4com-diagnostics.ts` (+6 testes). typecheck ✅ lint ✅ 1.919 testes ✅ build ✅. Precisa de deploy para ler a conta do Julio Cesar. |
| 2026-09-10 | @dev (Dex) | **Escopo ampliado a pedido do Vini:** tabela "Resultado das ligações" (desfecho marcado pelo SDR: 6 opções + "Sem desfecho", ligações e % do total) ao lado do funil; "Distribuição de Duração" desceu para linha própria. `DISPOSITION_REPORT_LABELS` em `disposition.ts` (caixa postal = "Caixa postal" no relatório). typecheck ✅ lint ✅ testes ✅ (+1). Re-registro do webhook rodado com autorização do Vini: 10/10 OK na API4COM, mas a ligação do Julio Cesar feita depois continuou sem aviso — ver Nota 3. |
| 2026-09-10 | @dev (Dex) | InProgress → **Ready for Review**. T1–T4 feitas. typecheck ✅ lint ✅ 1.912 testes ✅ (+12 novos) build ✅. Conferência visual com os números reais do Julio Cesar (página temporária em `/docs/`, já apagada). Sem migration. Nada commitado (regra git manual). Item 1 (webhook) **bloqueado**: disparar o re-registro em prod foi negado pela trava de permissão — ver Dev Agent Record. |
| 2026-09-10 | @dev (Dex) | Draft → **InProgress**. Opção "1 + 2" aprovada pelo Vini no chat. Implementação do item 2 (tela). |
| 2026-09-10 | Vini + Claude | Story criada a partir do print da org **V4 Company Julio Cesar** (01–10/set): 1.023 ligações, 8h15 de duração, e o gráfico "Outcomes por Status" com ~100% "Não Conectada". |

## Executor Assignment
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["vitest", "typecheck", "lint"]

## Origem

Investigação de 10/set/2026 (prod, 01–10/set BRT):

- Org **V4 Company Julio Cesar** (`0bbf24f6…`): 1.057 ligações, **0** com `answered_at`, **0** com `hangup_cause`, **0** eventos em `webhook_events` vindos dos ramais 1000/1023/1025 (conectados em 01/set). A API4COM dessa conta **nunca entregou** `channel-answer`/`channel-hangup` — por isso `status` fica `not_connected` em 100% das linhas e o gráfico só mostra "Não Conectada".
- A duração exibida conta desde a discagem (inclui o tempo chamando) — não prova conversa: as 318 marcadas pelo SDR como caixa postal têm mediana de 20s.
- O desfecho que o SDR marca (`calls.sdr_disposition`) **existe e é gravado**, mas nenhum gráfico o mostra. Julio Cesar: 8 conversa relevante, 48 atendeu sem avanço, 20 pediu para ligar depois, 318 caixa postal, 3 falha técnica, 664 sem desfecho (63%). V4 Amaral: 7 conversa relevante e 70% sem desfecho.

## Story

**As a** gestor de SDRs,
**I want** ver na tela de Ligações quantas ligações foram atendidas por uma pessoa e quantas viraram conversa relevante,
**so that** eu enxergue a efetividade real do time, e não só volume e duração.

## Complexity
**S** — só leitura; sem migration; 1 módulo puro novo, ajuste de 1 service, 1 componente novo, troca de 1 gráfico.

## Scope

**IN:**

1. **Módulo puro `features/calls/effectiveness.ts`** com duas regras:
   - **Atendida por uma pessoa** = `isConnectedCall()` (regra canônica: atendida + ≥50s + não caixa postal) **OU** o SDR confirmou atendimento humano (`relevant_conversation`, `answered_no_progress`, `callback_requested`). O "OU" cobre ramal sem sinal de telefonia (caso Julio Cesar) e conversa curta confirmada pelo SDR.
   - **Conversa relevante** = SDR marcou `relevant_conversation` (só o SDR julga relevância).
   - A **Taxa de conexão** continua sendo `isConnectedCall()` pura — o mesmo número do Painel de Ligações e do BI. Nada em `connection.ts` muda.
2. **Cards novos** (2ª linha): Conversas relevantes · Taxa de conexão · Sem desfecho marcado.
3. **"Outcomes por Status" vira funil "Efetividade das ligações"**: Discadas → Atendidas → Conversa relevante (reusa `ConversionFunnelChart`), com a nota de quantas atendidas estão sem desfecho.
4. **Tabela "Efetividade por SDR"**: Ligações · Atendidas · Conversas relevantes · % relevantes · Sem desfecho.

**OUT:**
- Religar o webhook API4COM da org Julio Cesar (item 1 — operação, fora do código).
- Tornar o desfecho obrigatório no discador (item 3 — não aprovado agora).
- Painel de Ligações (`CallDashboardView`) — sem mudança.

## Acceptance Criteria
- [x] AC1 — Dado um período com ligações, a tela mostra os 3 cards novos com número e % sobre o total de ligações.
- [x] AC2 — O funil é monotônico (Discadas ≥ Atendidas ≥ Conversa relevante) para qualquer combinação de dados.
- [x] AC3 — Uma ligação marcada `voicemail` nunca conta como atendida, mesmo com `answered_at` e ≥50s.
- [x] AC4 — A Taxa de conexão da tela é idêntica à regra de `isConnectedCall()` (sem o "OU" do SDR).
- [x] AC5 — Quando nenhuma ligação do período tem confirmação da telefonia, o card de Taxa de conexão avisa isso em vez de só mostrar 0%.
- [x] AC6 — Tabela por SDR ordenada por total de ligações, com os mesmos critérios do funil.

## Tasks
- [x] T1 — `features/calls/effectiveness.ts` + testes
- [x] T2 — `call-statistics.service.ts`: calcular efetividade (geral e por SDR); tirar `outcomes` + testes
- [x] T3 — `CallEffectivenessBySdrTable.tsx` + trocar gráfico e cards em `CallStatisticsView.tsx`
- [x] T4 — typecheck, lint, testes, build; conferência visual

## Risks
- **Leitura mista:** "Atendidas" junta telefonia + SDR; "Taxa de conexão" é só telefonia. Os textos dos cards/funil explicam a diferença.
- **Desfecho pouco marcado** (63–70% sem desfecho) deixa "Conversa relevante" subestimada — o card "Sem desfecho marcado" deixa isso visível.

## Dev Agent Record
### File List
- `docs/stories/call-effectiveness-view.story.md` (novo)
- `src/features/calls/effectiveness.ts` (novo) + `effectiveness.test.ts` (novo, 8 testes)
- `src/features/statistics/services/call-statistics.service.ts` — `calculateOutcomes` → `calculateEffectiveness` (exportada)
- `src/features/statistics/services/call-statistics.service.test.ts` (novo, 4 testes)
- `src/features/statistics/types/call-statistics.types.ts` — `outcomes` → `effectiveness`
- `src/features/statistics/components/CallEffectivenessBySdrTable.tsx` (novo)
- `src/features/statistics/components/CallStatisticsView.tsx` — cards + funil + tabela
- `src/shared/constants/chart-colors.ts` — `CALL_EFFECTIVENESS_COLORS`
- `src/features/statistics/components/CallDispositionTable.tsx` (novo)
- `src/features/calls/disposition.ts` — `DISPOSITION_REPORT_LABELS`
- `src/features/integrations/services/api4com-diagnostics.ts` (novo) + `api4com-diagnostics.test.ts` (novo, 6 testes)
- `src/app/api/admin/check-api4com-config/route.ts` — devolve o resumo da integração; filtro por `orgId`
- `src/lib/supabase/fetch-all-rows.ts` (novo) + `.test.ts` (novo, 6 testes)
- `src/features/calls/effectiveness.ts` — `isDialerCall` (+2 testes)
- `src/features/statistics/services/call-statistics.service.ts` — paginação, `dialerCalls`/`externalCalls`, linha "Feita fora do discador" (+1 teste)
- `src/features/statistics/types/call-statistics.types.ts` — `isTruncated`, `key` na linha de desfecho
- `src/features/statistics/components/CallStatisticsView.tsx`, `CallDispositionTable.tsx`, `CallEffectivenessBySdrTable.tsx`
- `src/features/statistics/components/ConversionFunnelChart.tsx` — barra nunca menor que o texto (número e % encostavam em barra estreita; componente compartilhado com Conversão)

### Notas
1. **Números esperados em prod (01–10/set):** Julio Cesar = 1.065 discadas → 76 atendidas → 8 relevantes; taxa de conexão 0% com o aviso de telefonia muda; 668 sem desfecho (62,7%). V4 Amaral ≈ 343 atendidas → 7 relevantes, 70% sem desfecho.
2. `CallOutcomeBarChart.tsx` ficou **sem uso** (só esta tela o usava). Não apagado — decisão do Vini.
3. **Item 1 (webhook Julio Cesar) — diagnóstico:** 0 eventos em `webhook_events` dos ramais 1000/1023/1025 desde 01/set. O cron diário `reregister-api4com-webhooks` (jobid 57, 05:23 UTC) já reaplica o webhook em todas as conexões — e mesmo assim nada chega, então **re-registrar sozinho provavelmente não resolve**; a resposta do cron (`net._http_response`) já expirou. Próximo passo: rodar o re-registro uma vez e ler o resultado por ramal (precisa de autorização), ou conferir a integração no painel da API4COM da conta Julio Cesar.
   **Atualização 10/set 18:19 UTC:** re-registro rodado (autorizado pelo Vini) → API4COM respondeu `success` para os 10 ramais, incluindo 1000/1023/1025. A ligação do Julio Cesar das 18:22 UTC continuou **sem evento**; a V4 Amaral recebeu 4 no mesmo intervalo. **Hipótese principal:** o registro põe `webhookConstraint: { metadata: { gateway: integration.gateway } }` com o gateway que a API4COM criou para a conta, e o discador manda `gateway: flux-{orgId}` (`initiate-api4com-call.ts:46`). Se na conta do Julio esses dois não batem, a API4COM filtra todas as ligações. Para confirmar é preciso ler `/integrations` da conta — `check-api4com-config` descarta essa resposta hoje.
   **Diagnóstico em prod (10/set 20:40 UTC, rota nova, só leitura) — CAUSA CONFIRMADA:**
   - A integração que aponta direto para `app.enriqueceai.com.br` tem filtro de gateway (`sippulse`, `enriqueceai`, `salesforce`, `amocrm`…) e o discador manda `flux-{orgId}` → `dialerPassesConstraint: false` em **todos os 10 ramais, das duas orgs**. O webhook direto nunca funcionou para ninguém.
   - O que faz a Amaral funcionar é **outra** integração, gateway `webhook`, **sem filtro**, apontando para o n8n `webhook-n8n.v4companyamaral.com/webhook/api4com-call-event` (repassa para nós).
   - Julio Cesar: ramal 1025 tem essa integração `webhook`, mas com a URL do **editor** do n8n (`n8n.v4companyamaral.com/workflow/tXz0q6ahd06lvXaz`), não a do webhook → nada chega. Ramais 1023/1000 (mesma credencial, integração 67917) não têm integração `webhook` nenhuma — só `sippulse` (filtrada) e `mars-voip` (mktlab, de terceiro).
   - O payload traz `domain` (`v4amaral.api4com.com` em 100% dos eventos de 2 dias) → dá para resolver a org pelo domínio.
   - ⚠️ O cron `reregister-api4com-webhooks` faz PATCH em `integrations[0]` e troca a `webhookUrl` dela pela nossa — em alguns ramais essa integração é de CRM (`amocrm` no 1024, `salesforce` no 1033). Pode estar tirando eventos do CRM há tempo. Não mexido.
   **Efeito colateral:** `cleanup-ghost-calls` apaga ligações `flux-*` sem aviso e com duração 0 depois de 6h — então as tentativas de 0s do Julio Cesar estão sumindo da contagem.
4. **Achado lateral:** `reconcile-api4com-calls` registrou `fetched: 0` para as DUAS orgs na execução de 10/set 17:00 UTC (janela de 2,5h em horário comercial). Investigar separadamente.

## QA Results
_(pendente)_
