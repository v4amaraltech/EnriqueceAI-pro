# Handoff — Reconcile API4COM morto desde maio (fuso) + recuperação das ligações do Julio Cesar

**Data:** 10–11/09/2026
**Pedido de origem (Vini):** "investigar por que o worker `reconcile-api4com-calls` (pg_cron jobid 46) registrou `fetched: 0` para as DUAS orgs com API4COM na execução de 10/set 17:00 UTC".
**Estado final (11/09 ~00h30 BRT):** 4 PRs mergeados e no ar (`/api/version` = `485b39a6`). Ligações do Julio de 01–10/set recuperadas. Falta a conferência de 11/set 9h (agendada) e a limpeza do backup (~10/out).

Sessão paralela a `2026-09-10-efetividade-ligacoes-e-webhook-julio.md` (aviso/webhook do Julio, #375/#377/#378/#379/#382).

---

## 1. Causa raiz

A API4COM guarda `started_at` em **horário de Brasília com sufixo `Z`** (o `parseApi4ComTimestamp` já soma +3h na leitura). Desde o commit `6784c70f` (18/mai, troca para o filtro Loopback `?filter={"where":{"started_at":{gte,lte}}}`), o worker mandava o filtro em **UTC real** → a janela pedida caía **3h no futuro**. Qualquer janela < 3h (o cron usa ~1,5h) voltava vazia.

- `fetched: 0` em **toda** execução de 19/mai a 10/set, sempre com `last_status: success` — ninguém percebeu.
- Evidência: linhas com `metadata.source='reconcile_api4com'` só existiam em backfills manuais (19/mai e 12/ago, janelas de dias); nenhuma pelo cron.
- Impacto: a rede de segurança do webhook estava desligada. Crítico para o **Julio Cesar**, que não recebia nenhum aviso da API4COM desde 01/set.

---

## 2. O que foi entregue (4 PRs, todos no ar)

| PR | Squash | O que faz |
|---|---|---|
| [#374](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/374) | `bf3c1b46` | `toApi4ComFilterTimestamp` (UTC real → relógio da API4COM, −3h) em `api4com-time.ts`; o reconcile usa no `gte/lte`. |
| [#376](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/376) | `cebbd342` | Casamento do reconcile sem webhook: agrupa por ramal + número em ordem de horário e liga cada ligação à **linha mais próxima ainda livre** (`api4com-reconcile-matching.ts`). |
| [#384](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/384) | `38ae1140` | `admin/backfill-missing-voicemails`: mesma conversão; datas inválidas/invertidas → 400. ⚠️ `sinceIso/untilIso` agora são **UTC real** (dia inteiro de Brasília = `T03:00:00Z`). |
| [#386](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/386) | `485b39a6` | `admin/probe-api4com-voicemail`: janela declarada em UTC real e convertida — filtro enviado **idêntico** ao de antes (estava certo por acaso). |

**Regra:** todo filtro `started_at` enviado à API4COM passa por `toApi4ComFilterTimestamp`.

Primeira execução do cron com o código novo (10/set 20:00 UTC): `fetched` **92 (Julio) e 132 (Amaral)** — primeira vez > 0 desde maio.

---

## 3. Por que existiu o #376 (casamento)

A 1ª recuperação do Julio (com o #374) mostrou que, sem webhook, o fallback ramal + número + ±10min:
- pegava sempre a linha **mais antiga** da janela, sem pular linhas já ligadas a outra ligação;
- rodava 10 em paralelo → rediscagens do mesmo número (2–3 em poucos minutos, caso comum) disputavam a mesma linha.

Resultado da 1ª rodada: 78 linhas com 2 ligações coladas, ~600 ligações da API4COM sobrescritas sem rastro, 648 linhas do discador vazias, ~34 duplicatas. Na Amaral o efeito é pequeno (quase tudo casa pelo id do webhook antes do fallback).

---

## 4. Mudanças feitas em produção (fora do código)

| Quando (UTC) | O quê | Reverter |
|---|---|---|
| 10/set 19:15 | `dryRun` do reconcile p/ Julio (240h): fetched 1731, in_scope 1324, 0 erros | — |
| 10/set ~19:18 | **Backup** `public._bkp_julio_calls_reconcile_20260910` (1.116 ligações do Julio; RLS on, sem grant p/ anon/authenticated) | `drop table` após ~10/out |
| 10/set 19:19 | 1ª recuperação real (código do #374) — casamento ruim, ver seção 3 | desfeita às 20:18 |
| 10/set 20:18 | **Restore** do backup: 492 ligações voltaram às colunas do backup (hangup_cause, recording_url, duration, status, connected, transcription_*, metadata) + 182 inseridas pelo reconcile apagadas. Nada do SDR tocado (conferido coluna a coluna) | — |
| 10/set 20:19 | 2ª recuperação real (código do #376), 240h: fetched 1719, 0 erros | — |
| 11/set 03:10 | 5 gravações (10/set 18–19h) re-baixadas com `persist-recording` `force: true`; `e57bbd01` re-transcrita (`transcription_status` → `pending` → `completed`) | — |

Todas autorizadas pelo Vini no chat. ⚠️ O restore foi "rodado" 2x pelo Vini no SQL Editor e relatado como gravado, mas o banco **não mudou** (conferido por MCP e pela API REST). Rodado por mim depois que a permissão foi liberada.

---

## 5. Resultado — ligações do Julio (01–10/set)

| | Backup | 1ª recuperação | **Final** |
|---|---|---|---|
| Total | 1.116 | 1.304 | **1.331** |
| Com motivo de desligamento | 0 | 657 | **1.325** |
| Com gravação | 19 | 290 | **429** |
| Conectadas | 0 | 282 | **427** |
| Linhas do discador sem dados da API4COM | 1.116 | 648 | **6** |
| Linhas com 2+ ligações coladas | – | 78 | **0** |
| Duplicatas aparentes | – | ~34 | **0** |

- **193 inseridas** = ligações que só existem na API4COM (76 `NORMAL_CLEARING` com gravação feitas fora do discador; o resto tentativas de 0s). **Nenhuma tem lead** — o reconcile não procura lead pelo telefone.
- A re-transcrição da `e57bbd01` saiu **idêntica** (mesmo md5) → o áudio já era o certo. As outras 4 têm < 90s (`TRANSCRIPTION_MIN_DURATION_SECONDS`) e não são transcritas.
- "Conectada" do reconcile vem de `hangup_cause` + duração; o REST **não traz `answered_at`** — para 01–10/set a regra oficial (answered-first) segue sem contar o Julio.

---

## 6. Pendências

1. ⏳ **Conferência 11/set 9h BRT** (scheduled task `conferencia-webhook-api4com-julio`, só leitura; adiantada de 10h para 9h e com checagem do worker de hora em hora). O app do Claude precisa estar aberto.
2. **Dropar** `_bkp_julio_calls_reconcile_20260910` depois de ~10/out.
3. **Alerta para `fetched = 0` em horário comercial** — hoje o worker grava `success` mesmo sem trazer nada (foi o que escondeu o bug por 4 meses). Não implementado.
4. **Lead nas ligações inseridas pelo reconcile** — ficam sem `lead_id` (193 no Julio). Avaliar usar `findLeadByPhoneService` como o webhook faz.
5. `CRON_SECRET` do `.env.local` está desatualizado (401 em prod); chamadas a workers em prod foram feitas com a service role.

---

## 7. Lições

- ⭐ **API4COM compara datas no relógio de Brasília com "Z".** Leitura: `parseApi4ComTimestamp` (+3h). Filtro: `toApi4ComFilterTimestamp` (−3h). Nunca mandar ISO cru.
- ⭐ **`success` com `fetched: 0` esconde falha.** Worker que não traz nada em horário comercial deveria alarmar.
- ⭐ **Sem webhook, casamento por fallback precisa pular linha já usada e escolher a mais próxima** — e não pode rodar em paralelo para o mesmo número.
- ⭐ **Conferir no banco, não no relato:** SQL rodado no editor e "deu certo" pode não ter gravado (transação desfeita / texto selecionado).
- ⭐ **Antes de implementar, `git log origin/main`** — a correção do webhook por domínio já tinha sido feita por outra sessão (#377).
- Cloudflare corta requisições longas em ~100s (erro 524), mas o worker continua no servidor — acompanhar por `worker_run_state` (`updated_at`).
- Backup antes de gravação em massa + restore só das colunas que o worker mexe (comparar `to_jsonb(c) - colunas` com o backup antes).
