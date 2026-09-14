# Handoff — Card "Ligações Realizadas" no ranking do Dashboard

**Data:** 14/09/2026
**Pedido de origem (Vini):** "quero mudar esse componente: ao invés de Atividades Realizadas, coloca Ligações Realizadas" — print do card de Atividades Realizadas (4.695 contra meta 8.000, lista de SDRs por média diária).
**Estado final:** mergeado e no ar (`/api/version` = `3b072a3`, 09:47 UTC). Story `dashboard-calls-ranking-card` **Done**. Worktree e branches removidos. A main ficou vermelha por 8 minutos por colisão com outro PR — resolvida (seção 4).

---

## 1. O que foi entregue

| PR | Squash | O que faz |
|---|---|---|
| [#411](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/411) | `3b072a34` | Card "Ligações Realizadas" no lugar de "Atividades Realizadas". |
| [#413](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/413) | `9a3b5ae5` | Story → Done. |
| [#414](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/414) | `f4cf179f` | Conserta a main (teste de ordem usava o nome antigo do campo) — ver seção 4. |

Story: `docs/stories/dashboard-calls-ranking-card.story.md`.

---

## 2. Como o card funciona

- **Realizado:** `calls` do SDR (`user_id`) com `type='outbound'` no período — discador + Callface, recebidas não entram. Mesma definição do card "Total de Ligações" da seção "SDR selecionado" e do Sales Hub.
- **Meta mês:** **soma** de `goals_per_user.calls_target` dos SDRs do card (hoje 5 × 2.200 = 11.000). Decisão do Vini: não existe meta de ligações no nível da org, e assim o card nunca desalinha da meta que cada SDR vê no card dele.
- **Contagem:** exata por SDR (`count: 'exact', head: true`), sem baixar as ~11 mil linhas/mês. `fetchCallsRanking` em `ranking-metrics.service.ts`.
- **Filtros:** vendedor vale (SDR de fora não é consultado nem soma meta); cadência **não** se aplica, e o tooltip diz isso.
- **Sem coluna "ideal dia":** o ideal é acumulado do mês (~838 ligações) e ficaria ao lado de um número por dia (117). O `idealToDate` por SDR continua calculado, pronto para virar uma **cota diária** (meta ÷ dias úteis ≈ 105) se o time quiser.
- **Atividades:** `RankingData.activitiesDone` virou `callsDone` e `fetchActivitiesRanking` foi removida (ficou sem consumidor). A **meta de atividades continua** no "Editar metas" — Estatísticas › Atividades ainda usa. A RPC `count_activities_by_performer` segue no banco.

### Números (01–14/set, conferidos no banco)
Giovanni 1.174 · Guilherme 890 · Matheus 858 · João 851 · Ismael 773 = **4.546** contra meta 11.000. No período, todas as ligações são `outbound` — o filtro não esconde nada.

---

## 3. Metas de ligação de setembro

Já estavam preenchidas pelo Vini no "Editar metas" (14/set 09:01 UTC): os 5 SDRs com **2.200 / 176**, iguais ao Sales Hub. O João estava com 129 conectadas e foi alinhado para 176. Nada foi escrito no banco por esta sessão.

---

## 4. A main ficou vermelha (colisão de PRs)

**O que houve.** O #411 renomeou `RankingData.activitiesDone` → `callsDone`. O **#412** (mover a seção "SDR selecionado" para depois dos rankings, de outra sessão) foi criado **antes** disso e acrescentou um teste novo usando o nome antigo. Cada PR passou no CI da sua própria branch; juntos na main, o typecheck quebrou em `DashboardView.test.tsx:379`.

**Resolução.** PR **#414** trocou o nome no teste. Ordem de merge: #414 → #413. Main verde de novo às 10:01 UTC.

⭐ **Lição:** renomear campo de um tipo compartilhado com PRs em voo é quebra garantida — avisar (ou rebasear) os PRs abertos que tocam o mesmo arquivo antes de mergear.

---

## 5. Pendências

1. **Conferir o card logado** (o visual foi conferido só por HTML estático com o CSS do build, claro e escuro).
2. Avaliar a **coluna de cota diária** no lugar da "ideal dia" que foi retirada.
3. Da sessão anterior, ainda aberto: conferir a seção "SDR selecionado" logada.

---

## 6. Lições

- ⭐ **Ideal acumulado não se compara com média diária.** Se a coluna principal é por dia, o ideal ao lado também tem que ser por dia.
- ⭐ **Meta do time por soma das metas individuais** evita um segundo número para manter alinhado (e foi o que o Vini escolheu).
- ⭐ **Não rodar `pnpm build` e `pnpm test:run` ao mesmo tempo:** 8 arquivos de teste sem relação nenhuma (reports, whatsapp-calls) falharam por disputa de máquina e passaram sozinhos. Quase virou caça a bug inexistente.
- Contagem por SDR com `count: 'exact', head: true` resolve "quantos" sem esbarrar no teto de linhas do PostgREST — alternativa mais simples que paginar.
