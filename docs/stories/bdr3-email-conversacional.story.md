# Story: BDR-3 — E-mail conversacional (ingestão contínua, conversa com lock, intenção de resposta)

## Status
InProgress

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-21 | Vini + Claude | Story criada a partir do plano BDR-IA (repo callcenter, `docs/bdr/plano-bdr-ia.md`, §7.1). Migração, ingestão, conciliação e rotas v1 implementadas. |

## Origem

O BDR de IA precisa **conversar** por e-mail (qualificar, oferecer horários, agendar), não só detectar a primeira resposta. O detector atual (`check-email-replies.ts`) para de olhar o par cadência/lead depois da primeira `replied` — foi feito para entregar ao SDR. **`replied` encerra a prospecção; não pode encerrar a escuta.**

## Regras (contrato do plano, não negociar)
- Ingestão por caixa do BDR (`gmail_connections.bdr_ai = true`), independente da cadência; identidade única `(mailbox_user_id, gmail_message_id)`.
- Cursor `history_id` + `last_processed_internal_date`; 404 → recuperação desde o último ponto com sobreposição de 1 dia, paginada; sem ponto → 30 dias com alerta.
- Filtros: própria caixa/irmãs, auto-reply (`Auto-Submitted` ≠ no, `X-Autoreply`, assuntos), DSN/bounce, remetente sem lead.
- Conversa com estado `ia_ativa | aguardando_lead | humano_assumiu | encerrada`, lock com dono e renovação (RPCs `claim/renew/release_email_conversation_lock`).
- Intenção de resposta gravada com `Message-ID` **antes** do envio; erro classificado por código/motivo/estágio: 4xx na resposta → `falhou` (retentativa controlada), timeout/rede/5xx → `incerta` (conciliação por `rfc822msgid`, **nunca reenvia sozinho**). Busca vazia não prova rejeição.
- Bloqueios com finalidade (`contact_holds`): primeira resposta cria `prospeccao` (para cadência fria, IA continua); handoff cria `conversa` (IA para); opt-out = `total`.
- Teto diário da caixa conta respostas do agente; caixa pausada não envia.

## Entregue
- [x] `supabase/migrations/20260921150000_bdr3_email_conversacional.sql` — `contact_holds`, colunas em `gmail_connections`, `email_inbound`, `email_conversations`, `email_reply_intents`, RPCs de lock, crons `ingest-email-inbox` (*/5) e `reconcile-email-reply-intents` (*/10)
- [x] `src/features/email-conversations/services/inbound-classifier.ts` (+ testes) — classificação pura, texto puro, corte de citação, classificação do envio
- [x] `src/features/email-conversations/services/gmail-inbox.service.ts` — history.list / messages.list paginado, messages.get, busca por rfc822msgid, token da caixa
- [x] `src/features/email-conversations/actions/ingest-email-inbox.ts` — ingestão idempotente, conversa, replied + hold, webhook `email.replied` (gatilho do agente)
- [x] `src/features/email-conversations/actions/reconcile-reply-intents.ts`
- [x] `src/app/api/cron/ingest-email-inbox`, `src/app/api/cron/reconcile-email-reply-intents`
- [x] `src/app/api/v1/email-conversations/[id]` (GET) e `[id]/[action]` (claim, renew, release, reply, handoff, resume, close)
- [x] `email.service.ts` — aceita `messageId` externo; devolve `httpStatus` e `stage` no erro

## Pendente
- [ ] Aplicar migração no projeto (`supabase db push`) e definir `app.settings.cron_secret` fora do git (padrão das migrações recentes).
- [ ] Criar usuários "Ana IA 1..3", conectar Gmail, marcar `bdr_ai = true`, `daily_cap` conforme rampa (10 → 40 → 80).
- [ ] Endpoint `webhook_endpoints` da org apontando para o n8n com evento `email.replied`.
- [ ] Workflow n8n "Ana IA — e-mail" (claim → ler conversa → Claude → reply → release; heartbeat a cada 60s; escalar para humano). Prompt em `callcenter/docs/bdr/prompt-agente-email.md`.
- [ ] Pausa automática por bounce/reclamação (`paused_reason`) — BDR-5.
- [ ] Regenerar `src/lib/supabase/types.ts` (`pnpm gen:types`) após a migração.

## Testes de aceite (plano §8)
- 3 respostas seguidas → todas gravadas, 1 conversa, 1 webhook por mensagem; lock impede 2 execuções.
- Gmail aceita e o executor cai → intenção `incerta` → conciliação acha por Message-ID → `enviada`, sem reenvio.
- Busca vazia → continua `incerta`; 400/403 → `falhou`; 503/504 → `incerta`.
- Lock expirado com executor antigo → `renew`/`reply` devolvem 409 `lock_perdido`.
- 404 do histórico / 10 dias fora → recuperação sem duplicar nem perder.
- Handoff → `reply` devolve 409 `ia_parada`; resume → volta.
