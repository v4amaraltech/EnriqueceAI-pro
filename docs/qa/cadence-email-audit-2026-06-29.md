# Auditoria Completa — Cadência de E-mail Automático

**Data:** 2026-06-29 · **Auditor:** @dev (Dex) + 5 subagentes paralelos · **Escopo:** aba "E-mail Automático" (cadências `type='auto_email'`, canal `email`)

**Método:** 5 agentes auditaram dimensões independentes (envio/agendamento, conteúdo/tracking, respostas/lifecycle, métricas, saúde/limites). Os achados CRITICAL/HIGH foram **verificados manualmente** por leitura de código e por consulta ao banco de produção (`dhkmonctyoaenejemkrt`, cadência real "Prospect - Educação").

**Status legenda:** ✔ = verificado (código + banco) · ⚠ latente = bug real que NÃO afeta a cadência auditada hoje, mas afeta outras configurações.

> ## ✅ ONDA 1 APLICADA (29/jun) — Confiabilidade
> **C1, H3, H4 corrigidos e validados** (typecheck/lint/1498 testes). `execute-cadence.ts`:
> - **C1:** o `catch` agora demove a interação a `failed` se uma exceção interromper o envio (e `emailDispatched` é marcado na confirmação, antes do update de metadata). Não há mais "phantom sent".
> - **H4:** avanço do enrollment migrado para o RPC atômico `advance_enrollment_after_step` (row-locked + idempotente).
> - **H3:** índice único parcial `uq_interactions_sent_step_lead` (migration `20260629140000`) + tratamento de `23505` no insert (avança idempotente em vez de reenviar). Backfill **não-destrutivo** reclassificou 39 `sent` duplicadas → `failed` (preservadas em metadata; 69 eram fantasmas do C1, só 2 grupos eram double-send real). 0 duplicatas restantes.
>
> **Pendente:** Ondas 3-5. Build local (`pnpm build`) e commit/push (@devops).

> ## ✅ ONDA 2 APLICADA (29/jun) — Métricas & A/B confiáveis
> **H1, H2, H5, H6, H7 corrigidos e validados** (typecheck/lint/1498 testes):
> - **H1:** `opened`/`clicked` herdam `ab_variant` do `sent` pai (`track/open`, `track/click`) — antes toda abertura caía na variante A.
> - **H2:** `replied`/`bounced` herdam `step_id`+`ab_variant` da `sent` originadora (`check-email-replies.ts`) — antes `step_id=null` os mantinha fora de `fetchStepAbMetrics`, e o qui-quadrado nunca rodava.
> - **H5:** o resumo da página de Performance passou a usar **prospect único** (leads distintos), unificando com a lista. Breakdown por step segue por evento (≈ equivalente por step).
> - **H6:** saúde usa `recentFailRate` (janela de 14 dias) em vez do failRate all-time — não mascara picos recentes. Novo campo `recentFailRate` em `AutoEmailCadenceMetrics`.
> - **H7:** `sent=0` com `failed/bounced>0` agora é "Crítico", não "Sem dados".
>
> **Nota:** o A/B fica correto para dados NOVOS. Interações `opened`/`replied`/`bounced` históricas não têm `ab_variant`/`step_id` — backfill via `metadata.sent_interaction_id` é opcional (não aplicado).
> **L8 (Finalizado):** reavaliado como **não-bug** — `enrollment.status='completed'` é o sinal correto de "esgotou a sequência" (replied/bounced são estados terminais distintos).

> ## ✅ SEGURANÇA APLICADA (29/jun) — M1, M2, M3
> Corrigidos e validados (typecheck/lint/1504 testes/**build**):
> - **M1** (open redirect em `/api/track/click`): agora só redireciona para URLs que **realmente aparecem no `message_content`** da interação (que guarda as URLs originais) — fecha o vetor de phishing **sem quebrar links legados** (não exige HMAC/env nova). UUID inválido, interação inexistente, URL forjada ou erro de DB → **400/502 (fail closed)**, nunca redireciona. +2 testes.
> - **M2** (injeção HTML via dados de lead): `renderTemplate(..., { escapeHtml: true })` no **corpo** (não no assunto, que é texto). Valores de lead (CSV/API) não quebram mais o HTML nem injetam markup. +4 testes.
> - **M3** (header injection / CRLF no assunto): `sanitizeHeaderValue` remove CR/LF de `From`/`To`/`Subject` em `buildRawEmail`.
>
> **Também corrigido:** `fix(build)` — `turbopack.root` fixado no projeto (um `~/package-lock.json` órfão fazia o build varrer `~/Documents` e quebrar via TCC do macOS). Build voltou a passar.
>
> **Pendente:** unsubscribe LGPD (M9), cota/warmup Gmail (H8), soft-bounce DSN (H10), circuit breaker org (M13), bot-filter no open-tracking (M6) — features maiores, exigem decisão de produto/jurídico.

---

## Sumário executivo

A função está **operacional** (envia, rastreia, para ao responder), mas tem **1 falha crítica de confiabilidade** (perda silenciosa de e-mail), **um motor A/B efetivamente quebrado**, **ausência de proteção de reputação/volume** e **lacunas de compliance (sem unsubscribe)** e segurança (open redirect, injeção via dados de lead).

**As taxas da tela (Abertura 37.7% / Responder 2.6%) NÃO são bug** — confirmado no banco: são por **prospect único** (114 leads), não sobre os 360 envios brutos. O problema das métricas é de **consistência entre telas** e **transparência**, não de cálculo.

| Severidade | Qtd | Destaque |
|-----------|-----|----------|
| 🔴 CRITICAL | 1 | Perda silenciosa de e-mail (enrollment avança sem enviar) |
| 🟠 HIGH | 10 | A/B cego, double-send, soft-bounce permanente, saúde enganosa |
| 🟡 MEDIUM | 12 | Open redirect, injeção HTML/CRLF, sem unsubscribe, preview≠envio |
| ⚪ LOW | 8 | Heurísticas frágeis, validações ausentes |

---

## 🔴 CRITICAL

### C1 — Perda silenciosa de e-mail: interação gravada como `sent` antes do envio ✔
**`execute-cadence.ts:473-492` (insert `type:'sent'`) → `:596` (envio) → `:697-702` (catch)**
A interação é inserida como `'sent'` **antes** de `EmailService.sendEmail`. O caminho de erro *retornado* (`:634`) marca `failed` corretamente, mas se `sendEmail` **lançar exceção**, o `catch` genérico (`:697`) só faz `result.failed++` — **não marca a interação como `failed`**. Verifiquei que `email.service.ts` pode lançar: o `fetch` de envio (`:317-324`) e o `decrypt` do token (`:245`) **não têm try/catch**. Falha de rede/token corrompido → interação fica `'sent'` falso → no próximo tick o guard de idempotência (`:330-354`) **avança o enrollment sem reenviar**.
**Impacto:** e-mail nunca sai, passo consumido, 100% silencioso para o SDR. Agravado pelo `maxDuration=120` matando a função no meio de um envio.
**Fix:** inserir a interação como `queued`/`pending` e promover a `sent` só após `emailResult.success`; no `catch :697`, marcar a interação como `failed`.

---

## 🟠 HIGH

### H1 — A/B: aberturas sempre atribuídas à variante A ✔
**`track/open/[interactionId]/route.ts:62-73` + `fetch-step-ab-metrics.ts:51-73`**
As interações `opened` não copiam `ab_variant`. Em `fetchStepAbMetrics`, linhas sem variante caem no bucket A → `variant_b.opened` é sempre ~0. Painel A/B de abertura é falso.

### H2 — A/B: respostas/bounces nunca entram no teste estatístico ✔
**`check-email-replies.ts:361,404` + `fetch-step-ab-metrics.ts:54`**
`recordReply`/`recordBounce` inserem com `step_id: null` e sem `ab_variant`; o cálculo A/B filtra `.eq('step_id', stepId)` → essas linhas nunca entram. `chiSquaredTest` recebe sempre 0 sucessos → `pValue` sempre `null`. **O teste de significância nunca produz resultado.**
**Fix (H1+H2):** carimbar `ab_variant` + `step_id` nas interações `opened`/`replied`/`bounced` (copiar de `metadata.ab_variant` do `sent`), ou correlacionar via `sent_interaction_id`.

### H3 — Double-send: idempotência sem trava atômica ✔ (confirmado no banco)
**`execute-cadence.ts:321-328` (SELECT) → `:473` (INSERT)**
Check-then-act com vários `await` no meio (template, IA), **sem índice único nem lock**. Confirmei no banco: o único índice único em `interactions` é `interactions_pkey` (a PK). `executePendingSteps()` manual usa o mesmo core e pode rodar concorrente ao cron → dois runs enviam o mesmo passo 2×.
**Fix:** índice único parcial `interactions(cadence_id, step_id, lead_id) WHERE type='sent'` + tratar `23505` como skip; ou claim atômico (`SKIP LOCKED`). O projeto já tem o RPC `advance_enrollment_after_step` (`FOR UPDATE`) — não usado no auto-email.

### H4 — Avanço do enrollment em JS não-atômico, ignorando o RPC que existe ✔
**`execute-cadence.ts:667-683`**
Avanço de `current_step` é um `UPDATE` solto; se falhar após o e-mail sair, o enrollment fica dessincronizado. O RPC atômico `advance_enrollment_after_step` (migration `20260615150000`, criado para os "ghost enrollments") só é usado no path manual.
**Fix:** usar o RPC (ou equivalente) também no auto-email; insert-da-interação + avanço numa transação.

### H5 — Métricas divergem entre telas ✔ (confirmado no banco)
**`fetch-auto-email-metrics.ts:123-124` (por prospect único) vs `fetch-cadence-performance.ts:174-175` (por evento)**
A lista mostra Abertura por **prospect único** (44/114 = 38.6%); a página de Performance da MESMA cadência mostra por **evento** (85/360 = 23.6%). Mesmo dado, dois números → perda de confiança.
**Fix:** padronizar uma definição em todas as telas, ou rotular explicitamente cada uma.

### H6 — Saúde usa failRate ALL-TIME → mascara problema recente ✔
**`AutoEmailTable.tsx:92-101` + `fetch-auto-email-metrics.ts:43-48` (sem filtro de data)**
`failRate = (failed+bounced)/(sent+failed+bounced)` sobre toda a história. Uma cadência com muitos envios antigos fica "Saudável" para sempre mesmo com pico de falha atual.
**Fix:** janela móvel (7-14 dias) para a saúde.

### H7 — `sent===0` vira "Sem dados" mesmo com 100% de falha ✔
**`AutoEmailTable.tsx:89-91`**
`m.sent` conta só `type='sent'` (sucesso); envios que falham viram `failed`. Cadência 100% quebrada (`sent=0, failed=N`) é rotulada "Sem dados / Nenhum envio registrado" em vez de "Crítico".
**Fix:** `sent===0 && (failed+bounced)>0` → Crítico.

### H8 — Sem teto diário, sem warmup, sem rastreio da cota Gmail ✔
**`execute-cadence.ts:23-26` + `email.service.ts:317`**
Único controle de volume: batch de 25/execução + delay 2s + janela comercial. Sem cota diária por conta, sem ramp-up. Conta Gmail nova pode disparar volume alto (risco de suspensão); estouro de cota vira "Bloqueado" silencioso.
**Fix:** cota diária por conta + warmup + parar/enfileirar (não falhar) no teto.

### H9 — Follow-up encadeado classificado como resposta do lead ⚠ latente
**`check-email-replies.ts:295-334`**
`checkThreadForReplyOrBounce` nunca compara o `From` com o e-mail da própria conexão. Em passos `reply_type='reply'` (mesma thread), o seu próprio passo 2 vira "resposta genuína" → cadência se auto-encerra no passo 2. **Não afeta "Prospect - Educação"** (todos os steps são `new_conversation`), mas quebra qualquer cadência que use threading.
**Fix:** descartar mensagens cujo `From` = endereço da conexão antes de marcar resposta.

### H10 — Soft bounce tratado como hard bounce permanente ✔
**`check-email-replies.ts:248,384-435`**
Bounce detectado só por substring no `From` (`mailer-daemon`/`postmaster`), sem parse de DSN (`Status: 4.x.x` transitório vs `5.x.x` permanente). "Delivery delayed"/greylisting/caixa cheia temporária → seta `leads.email_bounced_at` **permanente**, pausa todas as enrollments, alimenta auto-blacklist de domínio com falso positivo. Sem reset automático.
**Fix:** parsear DSN; só `5.x.x`/`Action: failed` = hard bounce; soft = retry/pausa temporária.

---

## 🟡 MEDIUM

| ID | Local | Achado | Fix |
|----|-------|--------|-----|
| M1 | `track/click/[id]/route.ts:9-88` | **Open redirect** — redireciona para qualquer `?url=` http/https, mesmo com interactionId inexistente. Vetor de phishing no domínio da plataforma. | Assinar (HMAC) `interactionId`+`url` ou validar contra links do e-mail. |
| M2 | `execute-cadence.ts:444-446` + `build-template-variables.ts` | Variáveis de lead injetadas **sem escaping de HTML** (dados vêm de CSV/API inbound). `<`,tags quebram o e-mail ou injetam markup. Corpo enviado nunca passa por `sanitizeHtml`. | HTML-escapar valores; sanitizar corpo final. |
| M3 | `email.service.ts:77-80,128` | **Header injection (CRLF)** no assunto: assuntos ASCII vão crus; `stripUnresolvedVars` não remove `\r\n`. Variável com CRLF+`Bcc:` injeta headers. | Remover CR/LF de subject e variáveis usadas em assunto. |
| M4 | `track/open/route.ts:42-74` | Race read-modify-write no `open_count` → aberturas duplicadas inflam "Abertos". **Latente: 0 duplicatas hoje no banco**, mas possível sob concorrência. | Incremento atômico / unique constraint. |
| M5 | `track/open` + `track/click` | Lost update no `metadata` (open e click relêem o objeto inteiro) — pode perder `thread_id`/`subject` do `sent`, afetando threading. | Merge atômico (`jsonb_set`/RPC). |
| M6 | `track/open/route.ts:38-78` | Sem filtro de bot/proxy (Google Image Proxy, Apple MPP) → toda entrega vira "aberto". Open-rate inflado. | Ignorar UAs de proxy / opens em N seg do envio. |
| M7 | `EmailPreviewPanel.tsx` vs `execute-cadence.ts:444-464` | Preview ≠ envio em 4 pontos; o mais grave: **preview nunca aplica IA**, mas o envio reescreve com IA. Usuário valida um conteúdo e envia outro. | Alinhar pipeline preview↔envio; avisar sobre IA. |
| M8 | `execute-cadence.ts:312-317` | Passo não-email em cadência `auto_email` faz `continue` **sem avançar** → enrollment presa para sempre. ⚠ latente (não afeta "Prospect - Educação"). | Avançar ao próximo passo email ou completar. |
| M9 | `types/index.ts:14` + `email.service.ts` | **Unsubscribe nunca implementado** — enum existe, mas nenhum código grava; sem header `List-Unsubscribe`, sem opt-out. Risco LGPD/CAN-SPAM. | Header `List-Unsubscribe` + página de opt-out + supressão persistente. |
| M10 | RPC `fetch_inactive_enrollment_candidates` | `expire-inactive` mede inatividade por última interação, ignorando `next_step_due`. Cadência com delay > `auto_loss_after_days` expira lead ativo antes do próximo passo. | Considerar `next_step_due`; validar config vs delays. |
| M11 | `check-email-replies.ts:42-49` | `BATCH_SIZE=100` **sem `.order()`** → cobertura de respostas não-determinística sob alto volume; após 30 dias nunca detecta. | Ordenar por `created_at` + paginar por cursor. |
| M12 | `execute-cadence.ts:241-248` | Lote global de 25 **sem `ORDER BY next_step_due`** → starvation entre orgs; teto ~3.000/dia global. | `.order('next_step_due')` + cota por org. |
| M13 | `check-email-replies.ts:457-524` | Proteção de reputação só por **domínio** (≥3 bounces e ≥50%); pico espalhado por muitos domínios nunca aciona. Sem circuit breaker por org. | Disjuntor org-level por taxa de bounce agregada. |

---

## ⚪ LOW

| ID | Local | Achado |
|----|-------|--------|
| L1 | `execute-cadence.ts:644-651` | Retry transitório sem backoff (re-tenta a cada 5 min) — pode agravar throttling do Gmail. |
| L2 | `execute-cadence.ts:172-185` | `isBusinessHours()` correto (timezone/DST) mas **não trata feriados** — e-mails saem em feriado. |
| L3 | `execute-cadence.ts:28-45` | Erro "quota/rate limit" do Gmail **não** está em `PERMANENT_EMAIL_ERRORS` → 3 retries martelando a API estourada. |
| L4 | `execute-cadence.ts:225-234` | Interações de sistema (reativação) com `type='sent'` inflam Enviados/Saúde e resetam o relógio do stale-alert. |
| L5 | `stale-cadence-alert.ts:63-69` | Ponto cego: se as falhas pausaram todos os enrollments (`active=0`), nenhum alerta dispara. |
| L6 | `declare-ab-winner.ts:7-55` | Declaração de vencedor sem revalidar amostra/dias/significância no servidor (só checagem client) e sem `requireManager()`. |
| L7 | `manage-enrollments.ts:125-163` | `updateEnrollmentStatus` (UI) sem validação de transição; reativar lead com `email_bounced_at` re-pausa e gera `failed` imediato. |
| L8 | `fetch-auto-email-metrics.ts:110` | "Finalizado" ainda lê de `enrollment.status` (fonte frágil) — pode subcontar sequências concluídas. As taxas de reply/bounce já migraram para `interactions` (#98/#99). |

---

## O que NÃO é bug (esclarecimentos)

- **Abertura 37.7% / Responder 2.6%** — correto por design (prospect único: 44/114 e 3/114). Verificado no banco. A confusão vem de a tabela misturar **contagens por evento** (Enviados 360, Abertos 85) com **taxas por prospect** sem rótulo. Recomenda-se rotular.
- **Rejeitado=`bounced`, Bloqueado=`failed`** — fonte canônica (`interactions`), OK. Mas "Bloqueado=14" mistura causas (sem e-mail, domínio em blacklist, sem `created_by`, erro Gmail, retries) — não é necessariamente deliverability.
- **Guard de janela 8h-18h BRT** — correto, sem off-by-one (`*/5 11-20 UTC` = 8h-17h55 BRT).

---

## Plano de correção priorizado

**Onda 1 — Confiabilidade (corrigir já):**
1. **C1** perda silenciosa de e-mail (marcar `failed` no catch + interação provisória)
2. **H3** índice único anti-double-send + tratar `23505`
3. **H4** usar RPC atômico no avanço

**Onda 2 — Métricas & A/B confiáveis:**
4. **H1+H2** carimbar `ab_variant`/`step_id` em opened/replied/bounced
5. **H5** padronizar definição de taxa entre telas
6. **H6/H7** saúde por janela móvel + tratar 100%-falha como Crítico
7. **L8** "Finalizado" de fonte canônica

**Onda 3 — Reputação & Compliance:**
8. **H8** cota diária + warmup
9. **H10** parse de DSN (soft vs hard bounce)
10. **M9** unsubscribe (LGPD)
11. **M13** circuit breaker org-level

**Onda 4 — Segurança & robustez:**
12. **M1** open redirect (HMAC)
13. **M2/M3** escaping HTML + CRLF
14. **M6** filtro de bot/proxy no open-tracking
15. **H9/M8** threading próprio + passo não-email travando

**Onda 5 — Qualidade (LOW):** L1-L7, M7 (preview≠envio), M10-M12.
