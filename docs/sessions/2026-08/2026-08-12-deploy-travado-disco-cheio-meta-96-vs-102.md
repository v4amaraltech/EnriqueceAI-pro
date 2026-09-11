<!-- Sessão de diagnóstico (sem alteração de código) -->
<!-- Data: 2026-08-12 -->
<!-- Org: V4 Company Amaral (c2727473-1df8-4faa-9264-a9fc1759fe3b) -->

## Sintoma relatado

Card **"Reuniões realizadas em Agosto"** no dashboard mostrava
**Meta = 96**, mas a soma das metas individuais dos SDRs dava **102**.
Pergunta: "onde está o gap?".

## Diagnóstico (cadeia completa)

O gap **não existia nas metas** — os dois números certos são iguais (102).
O card exibia um valor **defasado** porque o deploy de produção estava
travado. Cadeia de investigação:

### 1. As metas no banco batem
Tabela `goals` (org V4 Amaral, `month='2026-08-01'`):

| Campo | Valor |
|-------|-------|
| `meetings_held_target` (canônico, meta de reuniões) | **102** |
| `opportunity_target` (legado, meta de oportunidades) | **96** |
| Σ `goals_per_user.meetings_held_target` (SDRs) | **102** |

`meetings_held_target` (102) = soma dos SDRs (102). Sem divergência real.
Ambas as linhas foram salvas hoje **12/08 ~13:38–13:41**.

### 2. O card lê o campo canônico com fallback pro legado
`fetchOpportunityKpi` — `src/features/dashboard/services/dashboard-metrics.service.ts:140`:
```ts
const monthTarget = goal?.meetings_held_target || goal?.opportunity_target || 0;
```
Exibido em `OpportunityKpiCard.tsx:207` via `getDashboardData` (única função
do card). Com `meetings_held_target=102`, o resultado esperado é **102**.

### 3. Nada no caminho poderia devolver 96
- Página `src/app/(app)/dashboard/page.tsx` é `force-dynamic` (sem cache).
- Service client força `cache:'no-store'` (`src/lib/supabase/service.ts:20`)
  → sem Data Cache do Next.
- `createServiceRoleClient` bypassa RLS → sem filtro escondido.
- Usuário pertence a **uma única org** (V4 Amaral); há **uma única** linha
  `goals` de agosto. Sem ambiguidade de org/mês.
- `origin/main` tem o fix `45f081d` (23/mai, "consolidar metas duplicadas")
  desde há **322 commits**; HEAD = `bd45411` (11/08). Linha 140 já corrigida.

Conclusão: qualquer build do código atual, contra o banco atual, mostraria
**102**. Como a tela mostrava **96** (= `opportunity_target`, o fallback
legado que o código antigo lia direto via `goal?.opportunity_target ?? 0`),
o **artefato em execução no Coolify estava rodando código anterior a
`45f081d`** — deploy defasado. Hard refresh do browser não mudou nada
(o problema era no servidor).

### 4. Por que o deploy estava defasado
- CI do GitHub (Lint·Typecheck·Test·Build) **verde** no HEAD da main
  (`bd45411`, run 31545993882, 4m25s) → **não é código**.
- `Dockerfile`, `next.config.ts`, `package.json`, `pnpm-lock.yaml`
  **inalterados desde junho** → não é dessincronização de deps.
- **Último deploy do Coolify falhou** com **`No space left on device`
  (ENOSPC)**: disco do host cheio, `RUN pnpm build` (Dockerfile:13) não
  conseguiu escrever. Vilão típico: **cache de build do Docker** acumulado
  a cada deploy.

## Causa raiz

**Disco cheio no host do Coolify** → build falha → container não atualiza →
produção segue servindo build antigo (pré-`45f081d`) → card cai no fallback
`opportunity_target=96` em vez de `meetings_held_target=102`.

Os merges seguiam "verdes" no CI do GitHub o tempo todo, mascarando que
**nenhum deploy novo subia** desde que o disco encheu.

## Ação recomendada (no host do Coolify, via SSH)

```bash
df -h && docker system df          # ver o consumo
docker builder prune -af           # limpa cache de build (maior vilão, seguro)
docker image prune -af && docker container prune -f
df -h                              # confirmar espaço liberado
```
Depois: **redeploy no Coolify**. Card deve passar a mostrar **102**.

⚠️ **NÃO** usar `docker system prune -a --volumes` cegamente — `--volumes`
pode apagar dados de outros serviços no mesmo host.

**Prevenção:** Coolify → Settings → Advanced → ativar **Docker Cleanup**
automático (prune agendado). Causa raiz de "parou de deployar do nada".

## Status / pendências — CONCLUÍDO (12/08)

- [x] Rodar a limpeza de disco no host do Coolify.
- [x] Redeploy e confirmar card = **102** ✅ (build novo no ar, card bate com
      a soma dos SDRs).
- [x] Ativar **Docker Cleanup** automático no Coolify (prevenção) ✅
      **verificado** (campos de frequência/threshold persistiram após reload
      do painel) — prune agendado ativo para o disco não encher e travar
      deploy de novo.
- Nenhuma alteração de código necessária — a `main` já estava correta.

**Encerrado.** Sem itens em aberto.

## Lições

- ⭐ **CI verde no GitHub ≠ deploy no ar.** O Coolify faz build próprio
  (Docker) no host; disco/RAM do host podem falhar mesmo com o `next build`
  passando no CI. "Deployment skew" pode ser deploy que **nunca subiu**, não
  só cache de browser.
- ⭐ **Divergência de número em card** pode ser dado defasado por deploy
  travado, não bug de cálculo. Provar: banco + código-fonte + ausência de
  cache ⇒ valor esperado; se a tela diverge, o artefato em execução é antigo.
- ⭐ `goals.meetings_held_target` é o canônico da meta de reuniões;
  `opportunity_target` é legado (meta de oportunidades) e só aparece como
  fallback quando o canônico está vazio.
