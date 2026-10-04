# Story: Detectar respostas de e-mail na caixa certa

## Status
InProgress

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-04 | @dev (Dex) | Revisão adversarial (AJUSTAR): carimbo regravava o metadata inteiro e apagava aberturas/cliques gravados no meio da rodada. Vini escolheu função no banco → migration `20261004142659_merge_interactions_metadata` **aplicada em prod** (só `service_role` executa; conferido com `has_function_privilege`). Tipos regenerados. Logs no ramo de erro do Gmail e na falha do carimbo. |
| 2026-10-04 | @dev (Dex) | Implementado + testado (17 testes novos). |
| 2026-10-04 | Vini + Claude | Story criada a partir da auditoria de manutenção (agente de confiabilidade, achados 1 e 2). Vini escolheu atacar primeiro. |

## Origem

Auditoria de 04/out. Conferido em produção (30 dias até 04/10):

- **1.186** e-mails automáticos de cadência com `external_id`.
- **721** saíram da caixa Gmail do **SDR dono do lead** (dono com Gmail `connected`), mas foram gravados com `performed_by` = **criador da cadência**.
- O cron `check-email-replies` (a cada 10 min) abre a caixa do `performed_by` → a thread não existe lá → **0 respostas detectadas** pelo cron em 30 dias.
- Além disso o cron buscava `.limit(100)` **sem ordem** e só depois descartava os já tratados → conferia sempre as mesmas ~100 linhas.

Efeito: o lead responde e continua recebendo a cadência; o SDR não é avisado; o lead nunca vira "respondeu".

## Story

**As a** SDR,
**I want** que a plataforma perceba quando o lead responde um e-mail da cadência,
**so that** a cadência pare e eu seja avisado para continuar a conversa.

## Acceptance Criteria

1. O motor grava em `interactions.metadata.sender_user_id` o usuário cuja caixa Gmail enviou o e-mail. `performed_by` **não muda** (estatísticas e relatórios atribuem por ele).
2. O cron abre a caixa de `sender_user_id` quando existe.
3. Para envios antigos (sem `sender_user_id`), o cron tenta a caixa do dono do lead e depois a do criador da cadência; ao achar a conversa, grava `sender_user_id`.
4. Gmail 404 = conversa não está naquela caixa → tenta a próxima. Outro erro = não grava remetente; fica para a próxima rodada.
5. O carimbo mescla as chaves no banco (`merge_interactions_metadata`, `metadata || patch`) — nunca regrava o metadata inteiro, para não apagar `open_count`/`clicks` gravados em paralelo pelas rotas de tracking.
6. Rodízio: o cron busca primeiro os envios menos conferidos (`metadata.reply_checked_at` nulo primeiro) e carimba `reply_checked_at` em **todas** as linhas buscadas, inclusive as puladas (lead com bounce / já respondido).
7. Um lead com vários envios na mesma rodada gera **uma** resposta registrada.
8. Detecção de resposta automática (férias etc.) e de bounce continua igual.

## Scope

**IN:** migration `merge_interactions_metadata`, `execute-cadence.ts` (gravar remetente), `check-email-replies.ts` (caixa certa + rodízio), novo `services/reply-detection.service.ts` (funções puras), testes.

**OUT:** demais achados de confiabilidade da auditoria (erro passageiro do Google pausando cadência, webhook do WhatsApp, alertas de robô parado); backfill em lote de `sender_user_id` (o próprio cron aprende ao conferir); respostas que chegaram há mais de 30 dias.

## Riscos

- **Respostas antigas aparecem de uma vez** na primeira volta do rodízio (~2h): várias notificações "Lead respondeu" e cadências paradas para leads que responderam nos últimos 30 dias. É o comportamento correto, mas o time deve ser avisado.
- Linhas `sent` com `cadence_id` nulo seriam re-registradas a cada volta (o dedup ignora nulos) — hoje há 0 em prod; atenção quando o agente BDR gravar `sent` com `external_id`.
- `checkThreadForReplyOrBounce` conta qualquer mensagem após a primeira como resposta, inclusive do próprio SDR. Hoje não dispara (follow-ups `reply_type='reply'` não entram na mesma thread — bug à parte no motor), mas se isso for corrigido o detector precisa ignorar mensagens da própria caixa.
- Mais chamadas ao Gmail para linhas antigas (até 2 caixas por envio na primeira conferência); limitado a 100 envios por rodada, em lotes de 5.

## Tasks

- [x] Motor grava `metadata.sender_user_id`
- [x] Cron: candidatos de caixa + 404 → próxima caixa
- [x] Cron: rodízio por `reply_checked_at` + carimbo em todas as linhas
- [x] Carimbo via `merge_interactions_metadata` (migration aplicada em prod + `pnpm gen:types`)
- [x] Dedup de resposta por (cadência, lead) na rodada
- [x] Testes (`reply-detection.service.test.ts`, `check-email-replies.test.ts`)
- [x] Consulta ordenada validada em produção (leitura): PostgREST aceita `order=metadata->>reply_checked_at`
- [x] typecheck / lint / test:run / build
- [ ] PR + deploy + acompanhar primeira volta do rodízio

## File List

- `src/features/cadences/actions/execute-cadence.ts` (modificado)
- `src/features/cadences/actions/check-email-replies.ts` (modificado)
- `src/features/cadences/services/reply-detection.service.ts` (novo)
- `src/features/cadences/services/reply-detection.service.test.ts` (novo)
- `src/features/cadences/actions/check-email-replies.test.ts` (novo)
- `supabase/migrations/20261004142659_merge_interactions_metadata.sql` (novo)
- `src/lib/supabase/types.ts` (regenerado — inclui drift de prod: 2 tabelas `_bkp_*` e `cadences.executor`)
- `docs/stories/email-reply-detection-wrong-mailbox.story.md` (novo)
