# Plano de Implementação — Follow-up de reunião marcada (email + WhatsApp)

**Produto:** EnriqueceAI · **Org piloto:** V4 Company Amaral (`c2727473-1df8-4faa-9264-a9fc1759fe3b`) · **Supabase:** `dhkmonctyoaenejemkrt`
**Objetivo de negócio:** elevar comparecimento de reuniões (baseline ~56% → meta 85%) via lembretes cadenciados **antes** da reunião, no nome do SDR que marcou.

> Status: **Draft** (aguardando início da Entrega 1). Ground truth abaixo foi verificado no banco/código em 10/07/2026.

---

## 0. Decisões travadas (10/07)

1. **Motor in-app** (worker Next.js + pg_cron), **não n8n** — reusa a stack de envio existente.
2. **Email primeiro**: Entrega 1 é email-only; WhatsApp é fast-follow (Entrega 2, depende da F2).
3. **Piloto inbound + 1 SDR** (maior volume: `dcb4b327` — origem Blackbox) antes de expandir.

## 1. Ground truth verificado (não inventar)

- A reunião vive em `leads` (não há tabela `meetings`). Campos: `meeting_scheduled_at` (marcação), `meeting_starts_at` (**âncora T-0, UTC real** — render em `America/Sao_Paulo` confere), `meeting_held_at` (NULL = não realizada), `assigned_to` (remetente), `lead_source`, `status`, `email`, `email_bounced_at`, `phones` (**vazio** nos leads com reunião), `whatsapp_invalid_at`, `deleted_at`.
- **`lead_source`** só tem 3 valores: `Blackbox`→inbound, `Leadbroker`→inbound, `Outbound`→outbound.
- **Link do Meet É persistido** em `interactions.metadata->>'meet_link'` (interação `type='meeting_scheduled'`, `channel='calendar'`), junto de `calendar_event_id` e `start_time`. `leads` **não** tem coluna de link. `meet_link` pode ser nulo (reunião sem Meet) → template omite a linha do link.
- **Telefone**: ausente em `leads.phones`; fonte é `calls.destination` da ligação **conectada** (`calls.connected=true`) mais recente do lead. Isso é também a prova de opt-in (contato prévio). Amostra: 5/8 reuniões futuras têm ligação conectada; 3 caem para email.
- Helpers/So tabelas que **já existem** (reusar): `public.user_org_id()`, `public.is_manager()`, `public.effective_due_brt()`, `public.update_updated_at()`; tabelas `email_suppressions` (email+lead), `email_blacklist` (por **domínio**), `phone_blacklist` (por padrão), `worker_run_state`, `gmail_connections`, `whatsapp_instances`, `calendar_connections`.
- Infra de envio in-app pronta: `EmailService.sendEmail()` (Gmail send-as-SDR, token cripto), `WhatsAppEvolutionService.sendMessage()`, `WhatsAppService.validateBrazilianPhone()`, `renderTemplate()` (com `escapeHtml`), `src/lib/security/unsubscribe-token.ts`, `verifyCronSecret`. Padrão de 19 workers em `src/app/api/cron/*`.

## 2. Arquitetura

Módulo novo `src/features/meeting-reminders/` (convenção: `types` → `schemas` → `services` → `actions`) + worker cron. Config-driven: a ramificação inbound/outbound é **dado** (`reminder_steps`), não código.

```
pg_cron (a cada 15min) → POST /api/cron/meeting-reminders → verifyCronSecret
  → SELECT * FROM v_reminders_due            (lead × passo devido, canal viável, fora do log)
  → por linha:
      resolve remetente: assigned_to → gmail_connections (email) | whatsapp_instances (whatsapp)
      guardas: quiet-hours (8h–21h BRT), email_suppressions/email_blacklist, email_bounced_at / whatsapp_invalid_at
      renderTemplate(template, dados do lead + reunião em America/Sao_Paulo, meet_link)
      EmailService.sendEmail(...) | WhatsAppEvolutionService.sendMessage(...)
      meeting_reminder_log: reserve 'sending' (ON CONFLICT DO NOTHING) → update 'sent'|'failed'|'skipped'
  → worker_run_state (job_name='meeting-reminders').last_success_at
```

**Idempotência:** `UNIQUE(lead_id, reminder_step_id, meeting_starts_at)`. Reserve-before-send evita corrida entre execuções. Reagendamento muda `meeting_starts_at` → nova chave → re-dispara para o novo horário (desejado).

**Quiet-hours no worker (não na view):** toque devido fora de 8h–21h BRT → `skip` sem gravar log → re-tenta no próximo tick às 8h. A view devolve `fire_at <= now()`; o worker decide enviar/adiar.

**Visibilidade:** `meeting_reminder_log` é a fonte de verdade. **Não** gravar em `interactions` (evita poluir métricas de cadência); reavaliar se produto pedir timeline.

## 3. As duas sequências (timing relativo a `meeting_starts_at`; "no ato" relativo a `meeting_scheduled_at`)

| Contexto | Passo 1 (no ato) | Passo 2 | Passo 3 |
|---|---|---|---|
| **Inbound** | confirmação (data, hora, link, agenda curta) | T-24h reconfirmação | T-1h lembrete final c/ link |
| **Outbound** | confirmação formal reforçando o gancho | T-24h email de valor (re-vende) | T-2h lembrete final |

Entrega 1: todos os passos em `channel='email'`. Entrega 2: inbound inverte passos 2/3 para `whatsapp`.

---

## 4. Entrega 1 — Email (primeiro)

### F1 · Migração (aplicar via MCP `apply_migration`; padrão dev-checkpoints)
Objetos novos (idempotentes, `IF NOT EXISTS`/`ON CONFLICT`, `NOTIFY pgrst` ao final):

- `reminder_source_context(org_id, lead_source, context CHECK inbound|outbound, PK(org_id,lead_source))` + seed 3 origens.
- `reminder_steps(id, org_id, context, step_order, anchor CHECK meeting|on_book, offset_minutes, channel CHECK email|whatsapp, message_template_id FK message_templates, active, created_at, UNIQUE(org_id,context,step_order))` + seed 6 passos (email; whatsapp entra na F2).
- `meeting_reminder_log(id, org_id, lead_id, reminder_step_id, meeting_starts_at, channel, status DEFAULT 'sending', detail, sent_at, UNIQUE(lead_id, reminder_step_id, meeting_starts_at))`.
- View `v_reminders_due`:
  - FROM `leads` JOIN `reminder_source_context` (origem→contexto) JOIN `reminder_steps` (ativos).
  - `LEFT JOIN LATERAL` na última `interactions` `type='meeting_scheduled'` do lead → `meet_link`, `calendar_event_id`.
  - `fire_at` = `on_book` → `meeting_scheduled_at + offset` ; `meeting` → `meeting_starts_at + offset`.
  - WHERE `meeting_starts_at IS NOT NULL AND > now() AND meeting_held_at IS NULL AND status NOT IN ('archived','unqualified','won') AND assigned_to IS NOT NULL AND deleted_at IS NULL`.
  - Gate email: `channel='email' AND email IS NOT NULL AND email_bounced_at IS NULL`.
  - `NOT EXISTS` no `meeting_reminder_log` para a mesma chave; `fire_at <= now()`.
- RLS org-scoped nas 3 tabelas via `org_id = public.user_org_id()` (worker usa service role, ignora RLS).

**Aceite F1:** view retorna as reuniões futuras inbound/outbound com email válido; reaplicar migração não duplica.

### F3 · Templates
- Criar em `message_templates` (`channel='email'`), no máx. 3 por contexto; ligar `reminder_steps.message_template_id`.
- Variáveis: nome do lead, nome do SDR, data/hora **em America/Sao_Paulo**, `meet_link` (condicional), gancho (outbound). Assunto + corpo. Reusar `renderTemplate({ escapeHtml: true })` no corpo.
- **Aceite:** cada passo ativo com `message_template_id`; render de teste sem placeholder órfão.

### F4 · Worker
- `src/app/api/cron/meeting-reminders/route.ts` (`verifyCronSecret` → chama action) + `src/features/meeting-reminders/services|actions`.
- Resolve remetente por `assigned_to` (`gmail_connections`); sem conexão → `skipped`, `detail='sdr_sem_gmail'`.
- Guardas seção 6; render fuso BRT; `EmailService.sendEmail`; log idempotente reserve→sent/failed.
- pg_cron 15min → `net.http_post` para `app.enriqueceai.com.br/api/cron/meeting-reminders` (padrão dos demais crons).
- **Aceite:** rodar 2× envia cada lembrete 1×; email chega do SDR correto, data/hora BRT corretas; nada dispara para reunião `held`/passada.

### F5 · Piloto
- Ativar só inbound + SDR `dcb4b327` (confirmar nome no início). Medir comparecimento por contexto vs ~56%. Expandir por decisão baseada em delta.

---

## 5. Entrega 2 — WhatsApp (fast-follow)

- **F2 · Telefone + opt-in:** função `resolve_whatsapp_target(lead_id)` → número da ligação **conectada** mais recente (`calls`), normalizado por `validateBrazilianPhone`, respeitando `whatsapp_invalid_at IS NULL`. Habilitar `channel='whatsapp'` na view só com número + opt-in.
- Ativar passos WhatsApp: inbound WhatsApp-first (passos 2/3 `whatsapp`, passo 1 email+whatsapp); outbound WhatsApp só onde houve conversa naquele número, senão email.
- Envio via `WhatsAppEvolutionService.sendMessage`; espaçamento anti-ban por instância + teto diário.
- **Compliance inegociável:** WhatsApp só para número com contato prévio (via `calls`). Número só de enriquecimento nunca dispara.

---

## 6. Regras inegociáveis
Idempotência `(lead_id, step_id, meeting_starts_at)` · nunca disparar após `meeting_starts_at` (sem offset positivo; recuperação de no-show fora de escopo) · paradas: `meeting_held_at`, status terminal, passado · timezone BRT · quiet-hours 21h–8h · email_suppressions/email_blacklist/bounce/invalid · WhatsApp opt-in por `calls` · remetente = SDR (`assigned_to`), sem conexão → skip+log.

## 7. Fora de escopo
Recuperação de no-show (qualquer disparo após `meeting_starts_at`) · reagendamento automático · alteração da lógica de marcação existente.

## 8. Itens abertos (levantar, não decidir sozinho)
- Confirmar nome do SDR piloto (`dcb4b327`).
- Origens novas de lead no futuro exigem linha em `reminder_source_context`, senão o lead não recebe lembrete.
- Copy final dos templates (produto).

## 9. Definition of Done (Entrega 1)
F1 aplicada + `v_reminders_due` correta · templates ligados sem placeholder órfão · worker in-app idempotente enviando email do SDR no fuso certo com todas as guardas · piloto inbound+1 SDR ativo com medição de comparecimento.
