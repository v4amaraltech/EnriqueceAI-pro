# Handoff — "Leads abertos" volta a contar só lead novo (15/11/2026)

Pedido do Vini: o card "Leads abertos em Novembro" deve considerar só lead aberto novo, sem reaberturas. Decisões dele: vale para **tudo** (card, ranking, "SDR selecionado", Taxa de Aproveitamento, Sales Hub) e a meta de novembro (**754**) fica mantida.

## Regra
- Abertura = **1º toque humano qualificado do lead na vida** (phone, whatsapp, email, linkedin, research; tipo `sent`/`delivered`). Cada lead conta uma vez.
- Reabertura (1º toque depois de nova inscrição em cadência, regra de 18/09, `20260918121458_leads_opened_count_cadence_reopen.sql`) **não conta mais**.
- Mantido: exclui notas importadas (`is_note`) e leads arquivados/sem dono; crédito vai para `leads.assigned_to`; `p_cadence_ids` filtra pela cadência do próprio 1º toque.

## Entregue
- **Migration em prod** `20261115033217_leads_opened_only_new_leads.sql`: `leads_opened_events` passou a ter só o `first_ever`. Assinatura e grants iguais (EXECUTE só `postgres` e `service_role`). O arquivo leva o nome da versão que o Supabase registrou.
- **PR #627** mesclado (squash `7e2fa4c9`), no ar (`/api/version` = `7e2fa4c`): texto de ajuda do card ("lead que volta para uma cadência não conta de novo"), comentários dos serviços do dashboard, teste de integração renomeado para `tests/integration/leads-opened-only-new.test.ts`, teste do `get_sdr_leads_abertos_v2` ajustado (outubro sem reabertura; md5 de prod de `leads_opened_events` = `630a41294df66c56b78bda7505676eec`).
- **Sales Hub** (`ejxlbbbjyexsoltsxiqq`) re-sincronizado abr–nov via `sync_sdr_leads_abertos_batch`. Rafael Alecio (inativo, a função pula) corrigido à mão em mai/jun. `get_sdr_leads_abertos_v2` passa a devolver `reabertos: 0`.
- **Aviso ao time** enviado aos 5 SDRs depois do merge (Gmail, msg `1a1dd6c96d7b4e8f`), só com os totais do time, sem números individuais.
- Worktree `EnriqueceAI_Pro-leads-novos` e branch local removidos.

## Números (org V4, regra anterior → nova)
| Mês | Antes | Agora |
|---|---|---|
| Agosto | 1.614 | 1.257 |
| Setembro | 1.531 | 1.143 |
| Outubro | 1.351 | 946 |
| Novembro (até 15/11) | 381 | 283 |

Novembro fica cerca de 21% abaixo do ritmo da meta de 754 (esperado até 15/11 = 357). A Taxa de Aproveitamento sobe, porque o denominador diminuiu.

## Backups
- Sales Hub: `_bkp_pdi_leads_abertos_pre_only_new_20261115` (44 linhas, RLS ligado e sem acesso para anon/authenticated). **Dropar após ~15/12.**

## Lições
- Rodar o corpo da função como SELECT em prod antes de aplicar (de novo bateu: 283).
- Testes de integração do Postgres: rodar **um arquivo por vez**. Em paralelo eles colidem ao criar as roles (`anon` já existe).
- O "conflito" relatado no PR era o CI vermelho por um teste instável (`CloserCalendarControls.test.tsx`), não conflito de merge. Passou no rerun; passa na main e localmente. Vale corrigir esse teste num PR separado se voltar a falhar.
- O sync do Sales Hub só atualiza SDR ativo; linhas de SDR inativo ficam com o valor antigo (não entram no card, mas ficam erradas na tabela).

## Tarde: Visão Geral 283 × menu SDR 282 no Sales Hub
- **Causa:** o lead de teste "TESTE — Monica (WhatsApp automático)" (`41a8d721-6073-484e-a81f-03544a186f07`), dono Vinicius (gestor). O "Leads únicos" da Visão Geral (`leads_pv.first_touch_at`) conta lead de qualquer dono; o "Leads Abertos" do menu SDR soma só SDRs ativos.
- **Correção:** lead arquivado em 15/11 16:11 UTC com `status='archived'` + `deleted_at`. O `archiveLead` do app só põe `deleted_at`, que `leads_opened_events` não filtra; por isso os dois. A cadência dele já estava concluída e a fila de WhatsApp, enviada.
- Enriquece nov → 282 na hora. Sales Hub: o n8n "Sync Leads PV" (`cNdb9RZLqFEM5S3t`, 4×/h) apagou a linha do `leads_pv`; conferido 16:27 UTC, Visão Geral = 282.
- Cadência (`960b218b-…`) e template (`452461b3-…`) do teste continuam lá (o handoff de 07/11 pedia para apagar).

## Textos de ajuda do Sales Hub
- **PR v4-sales-hub#150** mesclado (squash `91b66bf0`), no ar às 16:34 UTC (`/version.json`), texto novo conferido nos chunks `SDRs-*.js` e `Operacional-*.js`.
- Leads Abertos (menu SDR e Visão Geral SDR) = só lead novo, soma SDRs ativos; Leads únicos = mesma regra, qualquer dono; colunas "Reabertos" e "% reab." explicam que ficam em 0. Só texto.
- As colunas de reabertos e a linha "X novos · 0 reabertos" continuam na tela (sempre 0). Remover só se o Vini pedir.
- Worktree `v4-sales-hub-help-leads` e branch removidos. O checkout principal do Sales Hub tem mudanças soltas do Vini (`launch.json`, `AppSidebar.tsx`, `docs/exports/`), não mexidas.
- ⚠️ Eu disse que o deploy do Sales Hub era manual. Estava errado: o merge publica sozinho em ~1 min (memória `saleshub-deploy-coolify` corrigida).

## Pendências
1. Dropar o backup do Sales Hub `_bkp_pdi_leads_abertos_pre_only_new_20261115` após ~15/12.
2. (Opcional) Corrigir o teste instável `CloserCalendarControls.test.tsx`.
3. (Opcional) Apagar cadência e template do teste da Monica.
4. (Opcional) Tirar da tela do Sales Hub as colunas "Reabertos"/"% reab." e a linha "X novos · 0 reabertos".
