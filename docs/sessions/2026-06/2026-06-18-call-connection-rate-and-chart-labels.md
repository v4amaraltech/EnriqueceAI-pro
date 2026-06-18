# Handoff — 2026-06-18: Taxa de Conexão + rótulos de gráficos + WhatsApp (convite e grupo/órfãs)

> Sessão longa: 7 PRs (#51 taxa de conexão, #52 rótulo "Conclusão", #53 texto convite
> WhatsApp, #54 instâncias órfãs Evolution + self-heal grupo, #55 handoff, #56 botão
> Reconectar, #57 fallback de nome preso). Todos mergeados e deployados (incl. edge
> function via Supabase CLI, re-deployada). Ver Pendências ao fim.

Org V4 Amaral (`c2727473-1df8-4faa-9264-a9fc1759fe3b`). Agente: @devops (Gage).

> **Status final: 2 PRs mergeados e em produção, deploys verificados.** Tudo
> investigado por dado antes de corrigir.

## 1. Taxa de Conexão errada no "Ligações por SDR" (PR #51) — PRINCIPAL

### Problema relatado
O gestor notou que dois SDRs apareciam com **taxa de conexão de ~0%** no gráfico
"Ligações por SDR" (`/statistics/calls`): Giovanni Olivieri (ramal 1042) e Rafael
Alécio (ramal 1040) — apesar de terem milhares de ligações com conversa real.

### Diagnóstico (por dado, produção)
O gráfico (`CallsPerSdrChart`) e o cálculo (`calculateCallsBySdr`: `conectadas ÷
total`, conectada = status `significant`|`not_significant`) estavam **corretos**. O
defeito é no **dado de origem**:

- `status`/`connected` das `calls` são classificados automaticamente pela API4COM
  via `classifyApi4ComCall` (webhook em tempo real + worker `reconcile-api4com-calls`
  a cada 1,5h). DEFAULT no banco = `not_connected`. O classificador só marca
  "conectada" se houver `answered_at` **ou** `hangup_cause = NORMAL_CLEARING`.
- Evidência: Giovanni tinha **1973 de 1979** ligações com duração real (média 21s,
  máx 628s) mas todas em `not_connected`; Rafael **810 de 832** (média 26s). A coluna
  `hangup_cause` estava **NULL em ~99%** dessas ligações; `webhook_linked` ≈ 0 (vs
  ~99% nos SDRs saudáveis); zero linhas `source=external_api4com`.
- **Causa raiz:** os ramais 1040/1042 estão provisionados diferente na API4COM — o
  webhook chega **sem `answered_at` e sem `hangup_cause`** (só `duration`), então a
  ligação nunca sai do default; e o worker de reconciliação (uma chave por org) não
  cobre esses ramais para corrigir. Sonda local ao REST não rodou (`TOKEN_ENCRYPTION_KEY`
  vazio no `.env.local` — chave real só no Coolify).

### Correção (na origem + backfill)
- **Código (`api4com-classification.ts`):** novo fallback no `wasAnswered` —
  `!hangupCause && durationSeconds >= 15` ⇒ conectada (significant/not_significant
  pelo threshold da org). Constante `CONNECTED_FALLBACK_DURATION_SECONDS = 15`.
  **Gated em `hangup_cause` ausente** → nunca sobrepõe causa explícita de
  não-conexão (USER_BUSY, NO_ANSWER, ORIGINATOR_CANCEL...) nos ramais saudáveis.
  Limiar de 15s escolhido pelo gestor (corte conservador "conversa real").
- **+8 testes** no `api4com-classification.test.ts` (fallback, boundary 15s,
  garantia de não-regressão nos ramais saudáveis).
- **Backfill (SQL via MCP):** 1.490 ligações da V4 Amaral (`hangup_cause IS NULL
  AND status='not_connected' AND duration_seconds>=15`) → significant/not_significant
  + connected=true. Snapshot de rollback na tabela **`_backfill_conn_rate_20260618`**
  (pode dropar quando o gestor confirmar os números).

### Resultado (taxa de conexão, 30d)
Giovanni 0,1% → **46,1%** · Rafael 0% → **55,4%** · saudáveis intactos (~98%).
Números plausíveis para prospecção fria. Ligações novas desses ramais já entram
classificadas certo pelo fix.

**Arquivos:** `src/features/calls/services/api4com-classification.ts` (+ `.test.ts`).
Deploy Coolify verificado: release de produção = `35cc2b4` = HEAD da `main`.

## 2. Coluna "On time*" mal-nomeada (PR #52)

A coluna **"On time*"** na tabela de analytics de atividades (`/statistics/activities`)
não media prazo — media **taxa de conclusão**: `(enviadas + entregues + reuniões
agendadas) ÷ total` (`activity-analytics.service.ts:447`). E o `*` apontava para uma
nota de rodapé **que nunca existiu**.

- Renomeada para **"Conclusão*"** + adicionada a legenda do asterisco explicando a
  fórmula (e que não mede prazo/horário). Sem mudança de cálculo.
- **Arquivo:** `src/features/statistics/components/ActivityAnalyticsView.tsx`.
- Deploy Coolify verificado: release de produção = `69601d8` = HEAD da `main`.

## 3. Texto do convite WhatsApp ao lead (PR #53)
"Sua reunião foi agendada:" → **"Seu diagnóstico foi agendado:"** no `WhatsAppInviteModal`
(a V4 trata o 1º encontro como diagnóstico). Só copy. Deploy verificado: release `e07448b`.

## 4. Grupo WhatsApp não criado ao agendar reunião (PR #54) — investigação longa
**Sintoma:** grupo não era criado; Evolution retornava `500 "Connection Closed"` no
`group/create`. O envio individual ao lead (banner + texto) funcionava às vezes — é
o `WhatsAppInviteModal` → `sendWhatsAppInvite` (manual, `sendMedia`), caminho separado.

**Causa raiz:** o edge function `evolution-create-instance` (Deno) destruía só a
instância rastreada e, no "already in use", criava uma **nova com sufixo de timestamp**
(`ea_org_user_5qqp`), deixando a **antiga órfã e conectada** ao número do SDR. Duas
sessões Baileys no mesmo número → "Connection Closed". **Fingerprint:** nome com sufixo
4-char base36. **4 de 6 SDRs** afetados (Ismael/Giovanni/Rafael/Vinicius); Guilherme/Matheus limpos.

**Correção:**
- Edge function: novo `listInstanceNames()` varre TODAS as instâncias do usuário no
  Evolution (canônica + órfãs), logout+delete, e cria **uma só** com nome canônico sem
  sufixo. "already in use" residual → força delete e re-tenta o MESMO nome. **A varredura
  limpa órfãs automaticamente quando o SDR reconecta.**
- App `whatsapp-group.service.ts`: erro de sessão morta (`isSessionDeadError`, exportado
  de `whatsapp-evolution.service.ts`) → marca instância `disconnected` (UI pede reconexão).
- **Arquivos:** `supabase/functions/_shared/evolution.ts`, `supabase/functions/evolution-create-instance/index.ts`, `src/features/integrations/services/whatsapp-{evolution,group}.service.ts`.

**Deploys (DOIS alvos):** app via Coolify (release `1767dd8` = HEAD, verificado);
**edge function via `supabase functions deploy evolution-create-instance --project-ref
dhkmonctyoaenejemkrt`** (NÃO sobe pelo Coolify — CLI logada, projeto linkado). Ambos no ar.

**Ação operacional:** os 4 SDRs afetados clicarem "Conectar" 1× → varredura limpa as
órfãs. Ismael é o mais urgente (erro nos grupos hoje).

## 4b. Continuação WhatsApp — botão Reconectar (#56) + nome preso (#57)
Ao operacionalizar a reconexão, dois aprendizados:
- **UX:** quando `connected`, a UI só tinha "Desconectar" — reconectar exigia
  Desconectar→Conectar. **PR #56** adicionou botão **"Reconectar"** (1 clique = mesmo
  `connect()`, que varre órfãs + QR novo). `IntegrationsView.tsx`.
- **Evolution trava o NOME:** o servidor Evolution é **compartilhado** (v2.3.7, 50+
  instâncias de vários clientes) e mantém o nome reservado após delete ("already in use"
  no create, instância sumida do manager). Isso **bloqueava** o SDR (caso Ismael
  `ea_c2727473_dcb4b327`, 403 Forbidden). **PR #57:** após varredura + force-delete + retry,
  se ainda "already in use", conecta com **nome novo único** em vez de bloquear (a varredura
  já deslogou as antigas → aparelho escaneado é o único pareado, sem Connection Closed; o
  nome preso vira entrada morta). Ismael reconectou OK como `ea_c2727473_dcb4b327_md1h`,
  status `connected`. **Deploy via `supabase functions deploy` (re-deployado 2×).**
- **Conexão é por usuário:** cada SDR loga na própria conta; o manager não reconecta pelo
  outro. Card mostra "Conectar" (sem instância) ou "Reconectar/Desconectar" (conectado).
- **Resolução das órfãs presas:** delete manual no Evolution às vezes não libera o nome na
  hora; o fallback do #57 contorna isso (não precisa restart do servidor compartilhado).

## Validação
- Todos os PRs: `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm build` ✅.
  PR #51 (148 testes), #54 (91 integrations), #56 (17 IntegrationsView) também `pnpm test` ✅.
- CI `Lint·Typecheck·Test·Build` ✅ em todos (#51–#57). Squash em todos.
- **7 PRs na sessão:** #51, #52, #53, #54, #55 (handoff), #56, #57. Edge function deployada
  via Supabase CLI (re-deployada nas iterações do #57).

## Pendências
- **Reconexão de Vinícius e Guilherme** (têm órfãs) — agora NÃO bloqueia mais (fallback do
  #57), é só pedir pra reconectarem. Ismael e Rafael já reconectaram OK.
- **Teste final do grupo:** Ismael agendar reunião → confirmar grupo criado (log
  `[whatsapp-group] Group created`). Não dá pra ver pelo banco (não persiste).
- **Faxina opcional no Evolution:** nomes mortos presos (ex.: `ea_c2727473_dcb4b327`) —
  restart do servidor compartilhado libera; sem urgência (inofensivos).
- **`'Nenhuma instância encontrada'`** nos lembretes de atividade do **Rafael** (109× no log,
  `activity-reminders` → `resolveInstance` null mesmo com instância conectada) — revalidar
  DEPOIS que ele reconectar (provável reflexo da órfã).
- **Taxa de Conexão inflada nos ramais "saudáveis"**: Ismael aparece 99,8% mas tem ~593
  ligações "conectadas" com **duração ZERO**; com regra uniforme por duração (≥15s) seria
  ~16% (Matheus ~18%, Guilherme ~28%). O fix do #51 só corrigiu o lado subcontado. A
  correção robusta é **uniformizar "conectada" por duração** para todos. NÃO decidido.
- **Threshold "Significativa" = 180s** (V4 Amaral) faz a Outcomes mostrar quase nada como
  Significativa; e Sem Contato/Ocupado ficam zerados (API4COM manda ORIGINATOR_CANCEL/
  NUMBER_CHANGED → Não Conectada). É config/taxonomia, não bug. Avaliar baixar o threshold.
- **`_backfill_conn_rate_20260618`** (snapshot de rollback do #51) — dropar quando o gestor
  validar a Taxa de Conexão no painel.
- **Rotação do `CRON_SECRET`** segue PENDENTE (fora desta sessão) — não trocar no
  Coolify antes do verificador multivalor `feat/cron-secret-multivalue` estar no ar.
- ⚠️ O log baixado no Desktop (`...all-logs-2026-06-18-12-43-05.txt`) contém o **token do
  webhook api4com** em claro (`6d52509358f5…`) — não compartilhar / considerar rotacionar.

## Processo / infra (relembrar)
- Repo `Mercantes/EnriqueceAI-pro` é **redirect** pra `v4amaraltech/EnriqueceAI-pro`.
  Usar `--repo v4amaraltech/EnriqueceAI-pro` no `gh`.
- **Migrations/dados Supabase NÃO sobem pelo Coolify** — backfill aplicado via MCP à parte.
- **Coolify auto-deploy**: merge na `main` dispara build/deploy do código sozinho.
  Verificação: release SHA em `app.enriqueceai.com.br/login` deve bater com HEAD.
