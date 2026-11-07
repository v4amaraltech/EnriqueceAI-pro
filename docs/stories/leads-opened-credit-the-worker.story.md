# Story: Creditar quem trabalha o lead, não só o dono

## Status
Draft

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-18 | Vini + Claude | Story criada a pedido do Vini, a partir da conferência da story `leads-opened-count-reopen`. **Não implementada** — precisa de decisão do @po sobre as 3 perguntas em aberto. |

## Story

**As a** SDR que trabalha lead de outro colega,
**I want** que o meu trabalho apareça no meu indicador,
**so that** eu não fique sem crédito por um lead que eu abri.

## Contexto

Hoje "Leads Abertos" credita **o dono do lead** (`leads.assigned_to`), não quem fez o
contato. A fila de Atividades escopa por **visibilidade, não por posse**, então um SDR
consegue trabalhar lead de outro (ver `activities-queue-scopes-by-visibility-not-ownership`).

Medido em setembro/2026: **197 das 938 aberturas (21%) foram feitas por alguém diferente
do dono.** O caso mais claro é o Guilherme, que trabalhou **106 leads do Ismael**.

## ⚠️ A troca simples está ERRADA — evidência

Trocar `assigned_to` por `interactions.performed_by` produz uma distorção **maior** do que
a que resolve. Simulado em setembro/2026:

| SDR | Hoje (dono) | Se creditasse quem trabalhou |
|-----|-------------|------------------------------|
| Giovani | 295 | 292 |
| Matheus | 234 | 177 |
| Guilherme | 170 | **179** |
| Ismael | 130 | **11** |
| João | 108 | 92 |
| **Vinicius (gestor)** | **1** | **187** |

O Ismael desaba para 11 e o **gestor** sobe para 187. Motivo: os e-mails das cadências
automáticas ("Inbound — E-mail (auto)" e "Recovery — E-mail (auto)") gravam
`performed_by` = **dono da caixa de e-mail conectada** (hoje o Vinicius), não o SDR.
São 186 aberturas de setembro.

## ⚠️ Isto reverteria uma decisão consciente de maio/2026

A migration `20260522235053_leads_opened_attribute_by_assigned_to.sql` mudou a atribuição
de `performed_by` **para** `assigned_to` exatamente para consertar o Hit Rate, que estava
inconsistente: numerador por `assigned_to`, denominador por `performed_by`. Foi reportado
pelo próprio Vinicius em 22/05/2026.

A mesma decisão foi reafirmada em 03/09/2026 para Reuniões Realizadas (PR #350,
`rr-attribution-kpi-vs-ranking`): **regra única, sempre o responsável do lead**, alinhada
com o guia de cards e com o Sales Hub.

Qualquer mudança aqui precisa dizer o que acontece com o Hit Rate, senão reintroduz
o bug de maio.

## 🔎 Achado colateral: 20% das aberturas são e-mail automático

Ao investigar, apareceu um fato independente desta story: **188 das 938 aberturas de
setembro (20%) vêm de cadências de e-mail automático**, não de trabalho humano. Não é
regressão da story anterior — pela regra antiga já eram 113 de 697 (16,2%).

Isso é uma pergunta de produto por si só: um e-mail que o motor dispara sozinho "abre"
o lead? Se a resposta for não, o número do time cai ~20%. Pode virar story separada.

## Perguntas em aberto (decisão do @po / Vini)

1. **Quem recebe o crédito quando dono ≠ quem trabalhou?**
   a) Continua no dono (hoje);
   b) Vai para quem trabalhou;
   c) Vai para quem trabalhou **só quando é um SDR ativo** (exclui gestor e automação).
2. **O Hit Rate acompanha?** Se o denominador muda de dono para executor, o numerador
   (reuniões realizadas) precisa mudar junto, senão volta a inconsistência de maio.
3. **E-mail automático conta como abertura?** Se contar, a quem? Hoje cai no dono via
   `assigned_to`; por `performed_by` cairia no dono da caixa conectada.

## Escopo provável (a confirmar depois da decisão)

**IN:** regra de atribuição em `leads_opened_events`; alinhamento do Hit Rate; tratamento
das cadências automáticas; re-sync do Sales Hub; atualização dos textos de ajuda.

**OUT:** mudar a regra de o que conta como abertura (fechada na story
`leads-opened-count-reopen`); card de "leads trabalhados no dia".

## Riscos

- Mexer de novo no mesmo indicador **poucos dias depois** de avisar o time (e-mail enviado
  em 18/09) desgasta a confiança na métrica. Considerar agrupar com a decisão do e-mail
  automático e comunicar uma vez só.
- O Sales Hub consome a mesma RPC: qualquer mudança exige re-sync dos meses.
- Ismael cair de 130 para 11 em qualquer variante é sinal de que a regra escolhida está
  medindo a coisa errada.

## Dados de apoio (setembro/2026, org V4 Amaral)

- 938 aberturas no mês; 197 (21%) com dono ≠ executor.
- Pares (lead, dia) trabalhados em lead de outro dono: Guilherme 157 (106 leads do Ismael),
  Matheus 61, Vinicius 600 (337 do Ismael, 205 do Matheus, 58 do João).
- % dos pares (lead, dia) trabalhados que viram abertura: Giovani 57,4% · Guilherme 19,3% ·
  João 19,0% · Matheus 17,2% · Ismael 11,7%.

## Referências

- Story anterior: `docs/stories/leads-opened-count-reopen.story.md`
- `supabase/migrations/20260522235053_leads_opened_attribute_by_assigned_to.sql`
- `supabase/migrations/20260918121458_leads_opened_count_cadence_reopen.sql`
