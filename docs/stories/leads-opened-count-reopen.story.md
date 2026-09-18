# Story: "Lead aberto" passa a contar reabertura de lead

## Status
Ready for Review

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-18 | @dev (Dex) | Implementado. Migrations aplicadas em prod (Enriquece) + re-sync do Sales Hub. typecheck ✅ lint ✅ 2145 testes ✅ (+15 de integração) build ✅. Nada commitado (regra git manual). |
| 2026-09-18 | Vini + Claude | Story criada a partir da reclamação do Giovani. Decisões do Vini: regra = reinscrição em cadência; aplicar nos 2 projetos; histórico recalculado. |

## Story

**As a** SDR que retoma fila antiga (leads redistribuídos, Recomendação, Recovery),
**I want** que trabalhar um lead que volta para a cadência conte como lead aberto,
**so that** o indicador reflita o trabalho do dia em vez de ficar zerado.

## Contexto

Giovani Olivieri reportou em 16/09 que abre lead todo dia e o card não sobe.

A regra antiga contava cada lead **uma única vez na vida**, no dia do 1º toque humano.
Quem trabalha fila antiga marcava zero:

| Dia | Leads trabalhados | Contados | Por quê |
|-----|-------------------|----------|---------|
| 10/09 | 30 | **0** | 27 já tocados em jun/jul (redistribuição do Ismael) |
| 16/09 | 24 | **0** | 21 já tocados em mai/jun (Pesquisa da Recomendação feita por ele) |

Não era bug de código: a RPC estava correta para a regra antiga. O problema era a
**definição**.

## Regra nova

Uma **abertura** é um toque humano qualificado que seja:

- **(a)** o 1º toque do lead na vida — lead novo, igual à regra antiga; **ou**
- **(b)** o 1º toque depois de uma **nova inscrição em cadência** — reabertura.

Canais e exclusões seguem iguais (`phone, whatsapp, email, linkedin, research`;
fora notas importadas `is_note=true` e leads arquivados). Atribuição continua em
`leads.assigned_to`.

### Por que inscrição e não "N dias parado"

A inscrição é um evento explícito do processo: alguém colocou o lead na esteira.
"N dias" é um limiar arbitrário — uma ligação solta num lead esquecido viraria
abertura. Medições em prod (setembro/2026) das alternativas avaliadas:

| Regra | Total set. | Giovani |
|-------|-----------|---------|
| Antiga (1º toque na vida) | 695 | 158 |
| **Reinscrição (escolhida)** | **936** | **295** |
| Parado 30 dias | 942 | 277 |
| Parado 60 dias | 853 | 251 |

## Acceptance Criteria

1. Lead novo tocado no mês conta 1 abertura (comportamento antigo preservado).
2. Lead tocado em maio, reinscrito e tocado em setembro conta **de novo** em setembro.
3. Lead tocado de novo **sem** reinscrição **não** conta.
4. O mesmo toque não conta duas vezes quando chega pelos dois caminhos com
   `cadence_id` diferente (toque x inscrição).
5. Duas reinscrições no mesmo mês contam 2 aberturas.
6. Nota importada, lead arquivado e canal fora da lista não abrem lead.
7. `count_leads_opened_by_sdr_daily` devolve uma linha por abertura, batendo com o agregado.
8. `p_cadence_ids` filtra pela cadência da inscrição que reabriu.
9. `authenticated` e `anon` não executam nenhuma das três funções (invariante da
   auditoria SECURITY DEFINER de 09/09).

## Scope

**IN:** migration que reescreve `count_leads_opened_by_sdr` e `_daily` sobre um
helper novo `leads_opened_events`; textos de ajuda do dashboard; teste de
integração; re-sync dos meses no Sales Hub.

**OUT:** mudar a meta (1.400/org, 300/SDR — a regra nova projeta ~1.470 em
setembro, que é o tamanho da meta já definida); "Leads trabalhados no dia" como
card separado; corrigir o fato de o card do Sales Hub ignorar SDR inativo
(comportamento pré-existente).

## Tasks

- [x] Medir as regras alternativas em prod antes de decidir
- [x] Helper `leads_opened_events(p_org_id, p_cadence_ids)` com as duas fontes de abertura
- [x] `count_leads_opened_by_sdr` e `_daily` reescritas sobre o helper
- [x] Deduplicar o mesmo toque vindo dos dois caminhos (sem isso: 1.601 em vez de 936)
- [x] ACL: revogar de `anon`/`authenticated`, conceder a `service_role`
- [x] Textos de ajuda e comentários do dashboard atualizados
- [x] Teste de integração contra Postgres real (15 casos)
- [x] `metadata`, `auth.role()` e `goals` na fixture compartilhada
- [x] Migrations aplicadas em prod + smoke
- [x] Backups antes de mexer (Enriquece e Sales Hub)
- [x] Re-sync dos meses abr–set no Sales Hub

## Impacto medido

### Enriquece (org V4 Amaral)

| Mês | Antes | Depois |
|-----|-------|--------|
| 2026-04 | 438 | 446 |
| 2026-05 | 798 | 986 |
| 2026-06 | 1.071 | 1.218 |
| 2026-07 | 1.237 | 1.635 |
| 2026-08 | 1.255 | 1.614 |
| 2026-09 (até 18) | 695 | 937 |

### Setembro por SDR

| SDR | Antes | Depois |
|-----|-------|--------|
| Giovani | 158 | 295 |
| Matheus | 174 | 233 |
| Guilherme | 153 | 170 |
| Ismael | 125 | 130 |
| João | 85 | 108 |

### Efeito colateral: Hit Rate cai

"Taxa de Aproveitamento" = reuniões realizadas ÷ leads abertos. O denominador
cresceu, então a taxa cai. Setembro: Giovani 1,3% → 0,7%; Matheus 2,3% → 1,7%;
Ismael 22,4% → 21,5%. Não é piora de performance, é mudança de base.

## Dev Notes

- `leads_opened_events` **não tem guard de organização** (recebe `p_org_id` livre).
  Por isso só `service_role` executa. O guard segue nas duas RPCs públicas.
- O teste de integração descobriu que `service_role` não tinha `EXECUTE` no helper
  (prod não quebrou porque SECURITY DEFINER resolve a chamada interna como owner).
  Corrigido por migration própria.
- O Sales Hub **não reimplementa a regra**: recebe `{performer_id, cnt}` da RPC via
  n8n e grava em `pdi_monthly_goals`. O re-sync usou `sync_sdr_leads_abertos_batch`.
- Abr–jun no Sales Hub ficam abaixo do Enriquece porque **Rafael Alecio está
  inativo** e o card só soma SDR ativo. Regra pré-existente, não mexida.

## File List

- `supabase/migrations/20260918121458_leads_opened_count_cadence_reopen.sql` (novo)
- `supabase/migrations/20260918122225_leads_opened_events_grant_service_role.sql` (novo)
- `src/features/dashboard/components/SdrPaceSection.tsx` (texto de ajuda)
- `src/features/dashboard/services/sdr-pace.service.ts` (comentário)
- `src/features/dashboard/services/ranking-metrics.service.ts` (comentários)
- `tests/integration/leads-opened-reopen.test.ts` (novo, 15 casos)
- `tests/integration/fixtures/statistics-schema.sql` (+`metadata`, +`auth.role()`, +`goals`)
- `docs/stories/leads-opened-count-reopen.story.md` (novo)

## Migrations aplicadas em prod

| Projeto | Migration | Quando |
|---------|-----------|--------|
| Enriquece `dhkmonctyoaenejemkrt` | `leads_opened_count_cadence_reopen` | 18/09/2026 |
| Enriquece `dhkmonctyoaenejemkrt` | `leads_opened_events_grant_service_role` | 18/09/2026 |

## Backups (não dropar antes de ~18/10)

- Enriquece: `_bkp_leads_opened_pre_reopen_20260918` (números por SDR/mês, abr–set)
- Sales Hub: `_bkp_pdi_leads_abertos_pre_reopen_20260918` (31 linhas de `pdi_monthly_goals`)

## Pendências

- [ ] Commit / PR (regra git manual — aguarda pedido do Vini)
- [ ] Avisar o time de SDR da mudança de regra e da queda do Hit Rate
- [ ] Conferir se o fluxo n8n do sync mensal continua batendo no mês seguinte
