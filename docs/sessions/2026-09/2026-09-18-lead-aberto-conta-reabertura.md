# Handoff 18/09/2026 — "Lead aberto" passa a contar reabertura

## O que aconteceu

Giovani Olivieri disse que abre lead todo dia e o indicador não sobe. **Não era bug.**
A regra contava cada lead uma única vez na vida, no dia do 1º contato. Ele estava
trabalhando fila antiga (redistribuição do Ismael em 10/09, Recomendação cuja
Pesquisa ele fez em maio/junho, Recovery), então marcava zero em dias cheios:
30 leads trabalhados em 10/09 → 0 contados; 24 em 16/09 → 0 contados.

Vini decidiu mudar a definição: **retomar um lead é abrir de novo**.

## Regra nova

Abertura = toque humano qualificado que seja o **1º do lead na vida** OU o **1º
depois de uma nova inscrição em cadência**. Trabalhar o mesmo lead de novo sem
reinscrição não conta.

Alternativas medidas antes de decidir (setembro, org V4): reinscrição 936 ·
parado-30d 942 · parado-60d 853 · regra antiga 695. Escolhida a reinscrição por
ser um evento explícito do processo, não um limiar arbitrário.

## Estado: NO AR no banco, código ainda não commitado

- Migrations **aplicadas em prod** (Enriquece): `leads_opened_count_cadence_reopen`
  e `leads_opened_events_grant_service_role`.
- Sales Hub **re-sincronizado** (abr–set) via `sync_sdr_leads_abertos_batch`.
- Código do app (textos de ajuda + comentários + teste) está no worktree
  `.claude/worktrees/leads-reopened`, branch `feat/leads-opened-count-reopen`,
  **sem commit** (regra git manual).

Como a RPC é calculada na hora, o dashboard já mostra os números novos sem deploy.
O deploy do app só leva os textos de ajuda.

## Números

Setembro: 695 → 937. Giovani: 158 → 295. Agosto: 1.255 → 1.614.

A meta de 1.400/org continua fazendo sentido: pela regra nova setembro projeta ~1.470.

## Armadilhas encontradas (⭐ importante)

1. **⭐⭐ O `UNION` precisa deduplicar por (lead, momento), não pela linha inteira.**
   O mesmo toque chega pelos dois caminhos com `cadence_id` diferente (o do toque
   x o da inscrição). Sem o `DISTINCT ON`, setembro daria **1.601** em vez de 936,
   uma inflação de 71%. Peguei isso rodando a lógica como SELECT antes de aplicar.
2. **⭐ Rodar a migration como consulta antes de aplicar** salvou o item 1. Vale
   sempre para mudança de métrica.
3. **⭐ `service_role` não herda EXECUTE em função nova.** O helper
   `leads_opened_events` nasceu sem grant; prod não quebrou porque SECURITY DEFINER
   resolve a chamada interna como owner, mas chamada direta dava "permission denied".
   O teste de integração pegou.
4. **⭐ O card do Sales Hub só soma SDR ativo.** Abr–jun ficam abaixo do Enriquece
   porque Rafael Alecio está inativo (278 em junho ficam de fora). Comportamento
   pré-existente — não mexi.
5. Para rodar os testes de integração sem Supabase local:
   `docker run -d --name pg -e POSTGRES_PASSWORD=postgres postgres:17-alpine` e
   `STATS_TEST_PG_URL='postgresql://postgres:postgres@127.0.0.1:5432/postgres'`
   `STATS_TEST_PSQL='docker exec -i pg psql -U postgres'`. A URL usa a porta
   **interna** (5432), porque o psql roda dentro do container.

## Efeito colateral a comunicar

"Taxa de Aproveitamento" (Hit Rate) = realizadas ÷ abertos. O denominador cresceu,
então a taxa cai: Giovani 1,3% → 0,7%, Matheus 2,3% → 1,7%, Ismael 22,4% → 21,5%.
Não é piora de performance. O time vai perguntar.

## Backups (não dropar antes de ~18/10)

- Enriquece: `_bkp_leads_opened_pre_reopen_20260918`
- Sales Hub: `_bkp_pdi_leads_abertos_pre_reopen_20260918`

## Próximos passos

1. Commit + PR quando o Vini pedir.
2. Avisar o time de SDR (regra nova + queda do Hit Rate).
3. Conferir o sync do n8n no fechamento de outubro.
4. Remover o worktree depois do merge.
