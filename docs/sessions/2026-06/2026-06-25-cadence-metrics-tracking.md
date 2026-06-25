# Sessão 2026-06-25 — Métricas de cadência de e-mail: Respondido, taxas e Rejeitado

**Agente:** @devops (Gage) · **Branch base:** main

## Problema (relato Vinícius)

Na tabela de cadências de **E-mail Automático** (cadência *Prospect - Educação*):

1. Houve respostas reais de e-mail, mas **Respondido = 0** (embora Responder % mostrasse 1.0%).
2. Dúvida posterior: os cálculos de **Responder %**, **Abertura %** e demais colunas estão corretos?

## Diagnóstico (raiz comum)

As métricas liam de **fontes inconsistentes** em `features/cadences/actions/fetch-auto-email-metrics.ts`:

- **Respondido** e **Rejeitado** vinham de `cadence_enrollments.status` (`'replied'` / `'bounced'`).
- **Responder %** e **Abertura %** vinham de `interactions` (`type='replied'` / `'opened'`) ÷ `sent`.

**Raiz:** `recordReply` e `recordBounce` (em `check-email-replies.ts`) só atualizam o enrollment com filtro `.eq('status','active')`. Em e-mail, a resposta/bounce quase sempre chega **depois** da sequência terminar (enrollment já `completed`) ou o enrollment nem existe mais. Resultado: o status nunca vira `replied`/`bounced`, mas a **interação É gravada**. Logo, métricas baseadas em enrollment subcontam.

Confirmado em produção: cadência tinha **3 interações `replied`** mas **0 enrollments `replied`**; os 3 leads estavam `completed` ou sem enrollment. Também: **114 leads distintos** com envio, mas só ~70 enrollments existentes hoje — enrollment é base instável.

Segundo achado (auditoria das taxas): **Abertura %** usava `eventos de abertura ÷ e-mails` (74 ÷ 307 = 24.1%), misturando unidades — o mesmo lead abre 5× e conta 5. Só **36 leads únicos** abriram, de 114 → taxa real por prospect = **31.6%**.

## Entrega

### PR #98 (squash `2448437`) — Respondido via interactions
- "Respondido" passa a contar `interactions type='replied'` (mesma fonte de replyRate). Cadência: 0 → **3**.

### PR #99 (squash `5f54aba`) — taxas por prospect único + Rejeitado robusto
| Mudança | Detalhe |
|---------|---------|
| Abertura % e Responder % por **prospect único** | leads distintos que abriram/responderam ÷ leads distintos que receberam. Busca passou a incluir `lead_id`; agrega contagens brutas (volume) **e** `Set<lead_id>` (alcance). |
| **Rejeitado** lê de `interactions type='bounced'` | em vez de `enrollment status='bounced'` (mesma fragilidade). |

Resultado em produção (*Prospect - Educação*): Responder % 1.0% → **2.6%** (3÷114), Abertura % 24.1% → **31.6%** (36÷114), Rejeitado 0 (robusto).

Colunas de **contagem** (Enviados, Abertos, Bloqueado, Respondido, Finalizado) seguem como volume bruto; só **taxas** e **Rejeitado** mudaram de fonte.

## Notas

- Mudança **puramente de leitura/agregação** — sem migração, sem alterar `recordReply`/`recordBounce`, sem mexer no schema.
- Quality gates: typecheck ✓ · lint ✓ · CI `Lint · Typecheck · Test · Build` ✓ (ambos PRs). Build local indisponível (restrição TCC do macOS em `~/Documents`) — CI é o gate autoritativo.
- Ambos validados em produção por Vinícius após Redeploy no Coolify.
- **Gap conhecido (não corrigido):** e-mail não registra `type='delivered'` (Gmail não dá delivery receipt); o sistema estima `delivered = sent − bounced`. Bounces só são detectados via polling de threads Gmail (`mailer-daemon`/`postmaster`), não por webhook.
- **Lição reaproveitável:** qualquer métrica que dependa de `cadence_enrollments.status` para eventos pós-sequência (replied/bounced) é instável — preferir `interactions` como sinal canônico. Vale auditar dashboard/relatórios/estatísticas com o mesmo critério.
