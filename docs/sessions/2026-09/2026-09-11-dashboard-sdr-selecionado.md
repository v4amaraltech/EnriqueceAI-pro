# Handoff — Seção "SDR selecionado" no Dashboard (7 cards de meta)

**Data:** 11/09/2026
**Pedido de origem (Vini):** "Preciso implementar algo parecido no menu Dashboard. Consegue avaliar o melhor local e como vamos chegar nessas métricas?", com um print do `/sdrs` → "Individual" do Sales Hub (Matheus Martins: 91/300, 4/20, 3/15, 834/2.200, 46/176, 9%/11%, 6%/8%).
**Estado final:** tudo mergeado e no ar (`/api/version` = `bfe6f89`, 11/set 10:31 UTC). Story `dashboard-sdr-pace-cards` **Done**. Worktree e branches (local e remota) removidos. Faltam só a conferência logada e o preenchimento das metas de ligação (seção 5).

---

## 1. O que foi entregue (3 PRs, todos mergeados)

| PR | Squash | O que faz |
|---|---|---|
| [#393](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/393) | `bfe6f89e` | Seção "SDR selecionado" no topo do Dashboard: seletor de SDR + 7 cards; metas de ligação no "Editar metas"; migration; `types.ts` regenerado. |
| [#396](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/396) | `376cf961` | Corrige o CI flaky "Closing rpc while fetch was pending" (mock do `notification.service` em `inbound-lead.service.test.ts`). |
| [#397](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/397) | `0c8c8336` | Story → Done. |

Story: `docs/stories/dashboard-sdr-pace-cards.story.md`.

---

## 2. Onde fica e como funciona

- **Local:** no topo do Dashboard, abaixo de "Visão geral" e dos filtros, antes dos 3 cards grandes. É o painel de "como estou hoje" do SDR.
- **Quem vê (decisão do Vini):** todos podem trocar o SDR. A seção abre no próprio usuário se ele for SDR; se não, no `?sdr=` da URL ou no 1º SDR da lista (ordem alfabética). A troca busca só os números (`getSdrPaceMetrics`) e atualiza `?sdr=` sem recarregar a página.
- **Filtros:** a seção segue o filtro de mês e **ignora** cadência e vendedores, porque as metas valem para o mês inteiro.
- **Segurança:** a action usa service role, mas só aceita SDR da própria org.

### Como cada número é calculado

| Card | Realizado (mesma fonte do ranking) | Meta |
|---|---|---|
| Leads Abertos | RPC `count_leads_opened_by_sdr` (1º toque humano, dono do lead) | `goals_per_user.leads_opened_target` |
| Reuniões Marcadas | `leads.meeting_scheduled_at` no mês + `assigned_to`, sem arquivado/deletado | `meetings_scheduled_target` |
| Reuniões Realizadas | `meeting_held_at` + `meetingsHeldWindowFilter` | `meetings_held_target` |
| Total de Ligações | `calls` `type='outbound'` por `user_id` no mês BRT (discador + Callface, igual ao SH) | **nova** `calls_target` |
| Ligações Conectadas | as mesmas linhas filtradas por `isConnectedCall` (piso de 50s) | **nova** `calls_connected_target` |
| Conectada p/ Marcada | marcadas ÷ conectadas | derivada: meta marcadas ÷ meta conectadas |
| % de Conectadas | conectadas ÷ ligações | derivada: meta conectadas ÷ meta ligações |

### Ritmo (porte fiel do Sales Hub: `PaceKpiCard` + `lib/pace.ts` + `buildTeamKPIs`)
Arquivo: `src/features/dashboard/utils/sdr-pace.ts`. Os dias úteis vêm de `utils/pacing.ts`, com feriados.

- **% atingido** = real ÷ meta.
- **Marcador** = dias úteis fechados (até ontem) ÷ dias úteis do mês.
- **"hoje: N"** = o que **falta fazer hoje** para fechar o dia no ritmo. Não é o que foi feito hoje. Se já está no ritmo, mostra "no ritmo · hoje: cota do dia".
- **"faltam X · Y/dia"** = o que falta para a meta ÷ dias úteis restantes, incluindo hoje.
- **Cores** pela razão % ÷ fração do mês:
  - ≥ 1,0: verde
  - ≥ 0,7: amarelo
  - abaixo disso: vermelho
- **Mês fechado ou 1º dia útil:** a cor sai direto do %: ≥ 100% verde, ≥ 30% amarelo.
- **Cards de taxa:** sem barra, sem "hoje" e sem "faltam". Mostram "na meta / acima da meta / abaixo da meta".
- **Casos especiais:** meta 0 deixa o card neutro ("sem meta").

### Paridade
- **Banco × Sales Hub (Matheus, set/2026):** 91 / 4 / 3 / 832 / 46 no banco, contra 91 / 4 / 3 / 834 / 46 no SH. As 2 ligações a mais do SH são o horário do sync.
- **Teste** `sdr-pace.test.ts`: reproduz exatamente a leitura do print de 11/set (ex.: "hoje: 24 · faltam 209 · 15/dia" e "hoje: 5 · faltam 1.366 · 98/dia").

---

## 3. Mudanças feitas em produção (fora do código)

| Quando (UTC) | O quê | Como reverter |
|---|---|---|
| 11/set 10:05 | Migration `20260911100515_goals_per_user_calls_targets`: `goals_per_user.calls_target` e `calls_connected_target` (`integer NOT NULL DEFAULT 0`). As 44 linhas existentes ficaram com 0. | `ALTER TABLE goals_per_user DROP COLUMN calls_target, DROP COLUMN calls_connected_target` (só depois de tirar o código que lê as colunas) |

A 1ª tentativa de aplicar pelo MCP foi bloqueada pela permissão da sessão. Passou depois do pedido explícito do Vini ("aplica a migration"). O MCP gravou a versão `20260911100515`, e o arquivo foi renomeado para bater.

---

## 4. Arquivos principais
- `src/features/dashboard/components/SdrPaceSection.tsx` — seletor + grade de 7 cards.
- `src/features/dashboard/components/PaceKpiCard.tsx` — o card, com tema claro e escuro.
- `src/features/dashboard/utils/sdr-pace.ts` — matemática do ritmo.
- `src/features/dashboard/services/sdr-pace.service.ts` — busca dos 5 realizados + metas.
- `src/features/dashboard/actions/get-sdr-pace-data.ts` — `getSdrPaceData` (carga inicial) e `getSdrPaceMetrics` (troca de SDR).
- `GoalsModal.tsx`, `get-goals.ts`, `save-goals.ts`, `goals.schema.ts` — campos "ligações" e "conectadas" por vendedor.
- `ranking-metrics.service.ts` — `getMonthRange` passou a ser exportado (mesma janela de contagem do ranking).

---

## 5. Pendências

1. **Conferir logado no Dashboard:** trocar SDR, abrir um mês passado e salvar metas de ligação no "Editar metas". A conferência visual foi feita só com HTML estático e o CSS do build (claro, escuro e tablet), sem login.
2. **Gestor preencher as metas de ligação de setembro** no "Editar metas" (o SH usa 2.200 e 176). Até lá, os cards de ligação e os 2 de taxa mostram "sem meta". Metas atuais de set: 300/20/15 (Ismael 200/60/48).
3. **Checkout principal desatualizado:** o checkout principal (`main` local) está atrás da `origin/main` e tem mudanças anteriores a esta sessão (ex.: `create-checkout.ts`). Não foi tocado.

---

## 6. Lições

- ⭐ **"hoje" do Sales Hub é o que falta fazer, não o que foi feito.** Portar a conta sem entender isso daria números diferentes do print.
- ⭐ **Metas de taxa são derivadas das metas de volume** no Sales Hub; não existe coluna de meta de taxa. Mantido igual.
- ⭐ **Erro ao ler metas não pode virar "sem meta".** O service lança o erro, e a seção mostra falha em vez de zerar as metas em silêncio (ex.: coluna ainda não aplicada no banco).
- ⭐ **Radix `Select` não mostra o valor no HTML do servidor.** Passar avatar + nome como filho do `SelectValue`.
- ⭐ **O MCP `apply_migration` grava a versão com o horário da aplicação.** Renomear o arquivo da migration para a mesma versão.
- **Sessão em worktree não usa o preview do app:** o preview lê o `launch.json` do checkout principal, e a sessão não pode editá-lo. A conferência visual foi feita com `renderToStaticMarkup` num teste temporário + CSS de `.next/static/chunks/*.css` + screenshot via `@playwright/test`.
- **CI flaky "Closing rpc while fetch was pending":** a causa era um `import()` fire-and-forget sem mock em teste. Corrigido no #396; não é mais "re-rodar resolve".
- **`gen:types` traz tudo que está em prod,** inclusive funções de outras sessões ainda não mergeadas (aqui, `get_interaction_counts`). O merge com a main ficou limpo porque o #392 gerou o mesmo trecho.
