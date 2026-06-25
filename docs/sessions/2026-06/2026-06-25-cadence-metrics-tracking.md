# Sessão 2026-06-25 — Métricas de cadência: fixes + auditoria app-wide

**Agente:** @devops (Gage) · **Branch base:** main

## Resumo executivo

Partiu de um bug pontual ("Respondido = 0" numa cadência) e virou uma **auditoria de todo o app** sob um único critério. Raiz comum: métricas que leem de `cadence_enrollments.status` subcontam eventos pós-sequência. **4 PRs de correção** (#98, #99, #100, #101) + dashboard auditado e aprovado limpo. Encerrou com as taxas de e-mail unificadas no padrão por-prospect em todas as telas.

## A raiz comum (critério da auditoria)

`recordReply`/`recordBounce` (em `features/cadences/actions/check-email-replies.ts`) só atualizam o enrollment com filtro `.eq('status','active')`. Em e-mail, a resposta/bounce quase sempre chega **depois** da sequência terminar (enrollment já `completed`) ou o enrollment nem existe mais. Resultado: `status` nunca vira `replied`/`bounced`, mas a **interação É gravada**. Logo, qualquer métrica baseada em `enrollment.status` subconta — a fonte canônica é a tabela `interactions`.

Segundo eixo: **taxas** devem ser por **prospect único** (leads distintos), não por evento bruto (o mesmo lead abre o e-mail N vezes = N eventos).

Verificado na org V4 (`c2727473-...`): `enrollment.status='replied'` = 1 vs **4** leads com interação `replied` real; 114 leads com envio numa cadência mas só ~70 enrollments existentes.

---

## Rodada 1 — Tabela de cadências (E-mail Automático)

### PR #98 (squash `2448437`) — "Respondido" via interactions
`fetch-auto-email-metrics.ts`: "Respondido" passou a contar `interactions type='replied'` (era `enrollment status='replied'`, travado em 0). Cadência *Prospect - Educação*: **0 → 3**.

### PR #99 (squash `5f54aba`) — taxas por prospect único + Rejeitado robusto
- **Abertura % / Responder %** → leads distintos que abriram/responderam ÷ leads distintos que receberam (busca passou a incluir `lead_id`; agrega contagem bruta + `Set<lead_id>`).
- **Rejeitado** → de `interactions type='bounced'` (era `enrollment status='bounced'`).
- Resultado: Responder % 1.0%→**2.6%** (3÷114), Abertura % 24.1%→**31.6%** (36÷114).
- Colunas de contagem (Enviados/Abertos/Bloqueado/Respondido/Finalizado) seguem volume bruto; só taxas e Rejeitado mudaram de fonte.

---

## Rodada 2 — Dashboard (auditado, LIMPO, sem fix)

12 métricas verificadas. 11 já leem de `leads`/`interactions`/RPCs sobre interactions (Reuniões Realizadas/Marcadas, Leads Abertos, Atividades, Tempo de Resposta, Hit Rate, Comparecimento, Leads para Abrir, Atividades Atrasadas, Razões de Perda, Conversão por Origem).

Único uso de `enrollment.status`: **"Leads Finalizados"** (`ranking-metrics.service.ts:141`, conta `completed OR replied`) — **robusto por design**: o balde `completed` já captura as respostas tardias, então não subconta. Confirmado: **0** enrollments `paused`/`bounced` com resposta real na org. Nenhum fix necessário.

---

## Rodada 3 — Relatórios + Estatísticas (auditadas)

~25 métricas. Quase tudo canônico (funil de conversão, atividades, performance SDR, ligações, motivos de perda, relatório geral, contagens de e-mail, engagement rate por step).

### PR #100 (squash `4aa21d4`) — replyRate da Cadence Analytics
`statistics/services/cadence-analytics.service.ts:101`: KPI global `replyRate` derivava `totalReplied` de `status='replied'` (1 vs 4 reais) → passou a contar leads distintos com interação `replied` (dado já vinha em `engagementInteractions`, mudança só de numerador). Impacto visual mínimo (org tem 4 respostas no total), mas estruturalmente correto.

### Definicional (consistente em todo lugar, mantido)
- **`completed || replied` como "conversão/won/finalizado"** em reports/statistics/dashboard — consistente e robusto por design (balde `completed` domina); não subconta.

---

## Rodada 4 — Unificar taxas por-evento → por-prospect

### PR #101 (squash `861480f`) — coerência de taxas entre telas
A lista de cadências virou por-prospect em #99, mas E-mail Analytics, tabela por step e Relatórios ainda calculavam taxas por **evento bruto** (aberturas ÷ enviados) → a *mesma* cadência mostrava 24.1% de abertura no E-mail Analytics e 31.6% na lista. Unificadas as três para **leads distintos que abriram/clicaram/responderam ÷ leads distintos que receberam**:
- `statistics/services/email-analytics.service.ts` — openRate, clickRate, replyRate (KPI cards)
- `statistics/services/step-analytics.service.ts` — openRate, clickRate, replyRate por step
- `reports/utils/metrics.ts` — openRate, replyRate, bounceRate da cadência

Colunas de contagem e os **funis de volume** (Funil de E-mails, funil de conversão) seguem por evento de propósito (lente de volume). Validado: `vitest run` statistics + reports = **81 testes ✓**. Confirmado no ar por Vinícius (período amplo: abertura 31.6% bate entre telas).

> Nota: E-mail Analytics é filtrado por período; a lista de cadências é histórica. Para bater exatamente, o período precisa cobrir desde o início dos envios — diferença de escopo de data, não de definição.

---

## Mapa final do critério no app

| Área | Resultado |
|------|-----------|
| Tabela de cadências | 🔧 corrigido (#98, #99) |
| Dashboard | ✅ limpo |
| Relatórios | 🔧 corrigido (#100, #101) |
| Estatísticas | 🔧 corrigido (#100, #101) |

## Notas

- Todas as mudanças são **de leitura/agregação** — sem migração, sem alterar `recordReply`/`recordBounce`, sem mexer no schema.
- Quality gates por PR: typecheck ✓ · lint ✓ · CI `Lint · Typecheck · Test · Build` ✓. Build local indisponível (restrição TCC do macOS em `~/Documents`) — CI é o gate autoritativo.
- Deploy = **Redeploy manual no painel Coolify** após o merge. #98, #99 e #101 validados visualmente por Vinícius; #100 confirmado no ar (impacto visual mínimo por design).
- **Gap conhecido (não corrigido):** e-mail não grava `type='delivered'` (Gmail não dá recibo); estima `delivered = sent − bounced`. Bounces só detectados via polling de threads Gmail (`mailer-daemon`/`postmaster`), não por webhook. Observação solta: a org tinha 395 interações `bounced` para só 13 leads distintos — possível re-inserção de bounce pelo cron (não investigado).
- **Lição reaproveitável (na memória):** qualquer métrica que dependa de `cadence_enrollments.status` para eventos pós-sequência (replied/bounced) é instável — preferir `interactions` como sinal canônico; usar leads distintos para taxas.
