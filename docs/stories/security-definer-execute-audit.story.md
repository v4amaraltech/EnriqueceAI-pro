# Story: Auditoria de EXECUTE em funções SECURITY DEFINER

## Status
Ready for Review

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-09 | Vini + Claude | Story criada a partir do incidente da migration `20260909184311` (DROP + CREATE reconcedeu EXECUTE a `authenticated` em `fetch_inactive_enrollment_candidates`). Escopo: varrer as demais funções `prosecdef`, revogar as indevidas, blindar as do Sales Hub e criar guarda contra reincidência. |
| 2026-09-09 | Vini | Decisões de escopo: (1) Sales Hub → blindar com shared secret mantendo `anon`, em migration separada de aplicação coordenada; (2) revogar as funções sem tráfego observado em 7 dias, aceitando a margem da retenção de logs. |
| 2026-09-09 | Claude (MCP Supabase) | **Migration A aplicada em prod** (`dhkmonctyoaenejemkrt`) como `20260909192822_revoke_definer_exec_audit` — arquivo do repo renomeado para bater com o `schema_migrations`. Ensaio prévio em `BEGIN … ROLLBACK` já previa o resultado exato. Verificado **depois** de aplicar: `authenticated` 42 → **16**, `anon` 36 → **10**, exatamente a allowlist; `service_role` mantido nas 64; **0 funções com `proacl` NULL** (nenhuma herdando PUBLIC); helpers de RLS íntegros nos 3 roles. Advisors `authenticated_security_definer_function_executable` e `anon_security_definer_function_executable` caíram para 16 e 10. Smoke test de 14 casos (6 revogações efetivas + 3 RPCs do app + 2 helpers RLS + 2 service_role + 1 Sales Hub): **14/14 PASS**. Migration B segue **não aplicada**. |

## Executor Assignment
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools: ["vitest", "typecheck", "lint"]

## Origem

Em 09/09/2026 a migration `20260909184311_auto_loss_after_cadence_completed.sql` recriou
`public.fetch_inactive_enrollment_candidates` com `DROP` + `CREATE` (a assinatura mudou, então
`CREATE OR REPLACE` não servia). O `DROP` descartou a ACL da função; o `CREATE` recriou-a com o
default privilege do schema `public`, que concede **EXECUTE a `PUBLIC`** — e portanto a `anon` e
`authenticated`. A migration `20260516160057_revoke_definer_anon_authenticated_exec.sql`, que havia
revogado exatamente essa permissão, **não sobrevive a um DROP**: `REVOKE` age sobre o objeto, não
sobre o nome.

A função varre `cadence_enrollments`/`leads` de **todas as organizações** sem filtro de tenant — é
feita para o cron com service role. Com EXECUTE para `authenticated`, qualquer usuário logado de
qualquer org podia enumerar a base inteira via `POST /rest/v1/rpc/fetch_inactive_enrollment_candidates`.

O caso pontual foi corrigido por `20260909184517`. Esta story trata do resto do schema.

## Story

**As a** responsável técnico pela plataforma,
**I want** que nenhuma função `SECURITY DEFINER` sem filtro de tenant seja executável por `anon` ou
`authenticated`, e que uma nova migration não possa reintroduzir essa permissão sem quebrar o CI,
**so that** um usuário logado de uma org não consiga ler nem escrever dados de outra.

## Complexity

**M** — 2 migrations de permissão (uma delas com `DROP`+`CREATE` de 3 funções), 1 allowlist
versionada, 1 teste de CI, 1 item de checklist. Zero mudança em código de aplicação.

## Levantamento (estado em 09/09/2026, projeto `dhkmonctyoaenejemkrt`)

64 funções `prosecdef` no schema `public`. Destas, **42 executáveis por `authenticated`** e **36 por
`anon`** — os mesmos números dos advisors `authenticated_security_definer_function_executable` e
`anon_security_definer_function_executable`.

O levantamento cruzou quatro fontes, porque nenhuma isolada basta:

1. `pg_proc.proacl` + `has_function_privilege()` — a permissão efetiva (inclui o `=X/postgres` de
   PUBLIC, que não aparece como `anon=X` mas concede a `anon` do mesmo jeito).
2. `pg_get_functiondef()` — se o corpo filtra por `user_org_id()` ou aceita `p_org_id` sem validar.
3. `pg_policies` — quais funções são usadas dentro de policies RLS (revogar quebra o app inteiro).
4. **Logs do PostgREST dos últimos 7 dias, agregados por função × role do JWT** — quem de fato chama
   cada RPC e com qual credencial.

A fonte 4 foi decisiva e mudou o plano: três funções que a análise estática marcaria como "revogar"
estão em uso real por `anon`.

### Helpers de RLS — MANTER (revogar quebra a aplicação inteira)

| Função | Policies que a usam |
|--------|--------------------|
| `user_org_id()` | 166 |
| `is_manager()` | 63 |
| `lead_visibility_mode()` | 2 |

Precisam manter EXECUTE não só para `authenticated`/`anon` como também para `authenticator` e
`supabase_realtime_admin` — o incidente registrado em `realtime-rls-helper-execute-revoked` foi
exatamente a perda desses grants derrubando o Realtime. **Esta story não toca nessas três.**

### Chamadas legítimas do cliente autenticado — MANTER `authenticated`

Todas filtram por `user_org_id()` internamente ou validam `p_org_id` contra ele. Confirmadas por call
site (`createServerSupabaseClient()`, que roda como `authenticated`) e por tráfego real:

| Função | Call site | Guarda interna | Tráfego 7d |
|--------|-----------|----------------|-----------|
| `count_leads_by_status(p_org_id)` | `features/leads/actions/fetch-leads.ts` | `p_org_id <> user_org_id()` → 42501 | 177 authenticated |
| `count_leads_by_loss_reason(p_org_id)` | `features/leads/actions/fetch-leads.ts` | `p_org_id <> user_org_id()` → 42501 | 178 authenticated |
| `get_distinct_lead_canais()` | `features/leads/actions/fetch-leads.ts` | `WHERE org_id = user_org_id()` | 177 authenticated |
| `get_distinct_lead_cnaes()` | `features/leads/actions/fetch-leads.ts` | `WHERE org_id = user_org_id()` | 177 authenticated |
| `get_executed_steps(...)` | `features/activities/actions/fetch-pending-activities.ts` | `WHERE org_id = user_org_id()` | 900 authenticated |
| `set_primary_lead_contact(p_contact_id)` | `features/leads/actions/lead-contacts.ts` | org do contato vs `user_org_id()` | via UI |

`count_leads_by_loss_reason` e `set_primary_lead_contact` carregam também `=X/postgres` (PUBLIC).
PUBLIC é redundante aqui e é justamente o que o default privilege reconcede — vai embora, os grants
ficam explícitos.

### Públicas por decisão de produto — MANTER `anon` (já blindadas por shared secret)

Consumidas pelo Sales Hub (projeto `ejxlbbbjyexsoltsxiqq`) com a anon key. Todas têm a guarda
`v_caller_org <> v_org_id AND auth.role() <> 'service_role' AND NOT verify_api_secret('v4sales_public_rpc', p_api_token)`
→ `Forbidden`. Documentadas assim desde `20260516161116_protect_public_rpcs_with_shared_secret`.

- `get_leads_for_v4sales(p_api_token, p_from_date)` — 41 chamadas anon, todas HTTP 200
- `get_indicacoes_ranking(p_year, p_month, p_api_token)` — 2 anon, 200
- `get_indicacoes_reunioes_realizadas(p_year, p_month, p_api_token)` — 2 anon, 200
- `get_indicacoes_leads_lookup(p_api_token)` — sem tráfego na janela

O `=X/postgres` de `get_indicacoes_leads_lookup` e `get_indicacoes_reunioes_realizadas` sai; `anon` e
`authenticated` ficam explícitos.

### CRÍTICO (a) — lê ou escreve dados de várias orgs sem filtro de tenant

Nenhuma tem tráfego `anon`/`authenticated` na janela de 7 dias. Todas as chamadas observadas chegam
com `service_role`.

| Função | Por que é crítica | Tráfego 7d |
|--------|------------------|-----------|
| `copiloto_match_lead(p_emails text[])` | Varre `leads` de **todas** as orgs por e-mail. Devolve nome, CNPJ, telefone, faturamento, `notes` e o BANT completo. Enumerável. | nenhum |
| `copiloto_leads_qualificacao(p_lead_ids uuid[])` | Mesma leitura cross-tenant, por id. | nenhum |
| `dados_para_novo_evento(p_lead_id text)` | PII completa do lead + e-mail do SDR lido de `auth.users`, sem filtro de org. | 1 service_role |
| `get_calls_for_v4sales(p_from_date, p_limit)` | Org V4 hardcoded. Dump de até 500 ligações com `recording_url` e `transcription`. | 21 service_role |
| `get_calls_for_v4sales_by_ids(p_ids uuid[])` | Idem, por id. | 173 service_role |
| `enriquecer_lead(p_lead_id, p_data jsonb)` | **UPDATE** massivo em `leads` de qualquer org + INSERT em `interactions`. | 39 service_role |
| `aplicar_reagendamento(p_event_id, p_novo_inicio)` | **UPDATE** em `confirmacoes_reuniao` e em `leads.meeting_starts_at`, sem org. | nenhum |
| `registrar_novo_evento_no_show(...)` | **UPDATE** em `no_show_disparos` e `leads`. | 1 service_role |
| `marcar_interacao_confirmacao(...)` | Lê por telefone/wamid sem org, **escreve** `confirmado_at`/`reagendou_at`, devolve dados da reunião. | 4 service_role |
| `marcar_resposta_no_show(...)` | Idem + devolve e-mail do lead. | 1 service_role |
| `push_first_touch_to_v4sales(p_apikey, ...)` | Dispara `net.http_post` em loop (até 40 lotes) para endpoint externo, com a apikey passada pelo chamador. Exfiltração e abuso de saída. | nenhum |
| `get_sdr_leads_para_abrir()` (v1) | Org V4 hardcoded, expõe e-mails de SDRs. Substituída pela v2. | nenhum |

### ALTO (b) — recebe org/usuário por parâmetro e não valida contra `auth.uid()`

| Função | Observação | Tráfego 7d |
|--------|-----------|-----------|
| `count_leads_opened_by_sdr(p_org_id, ...)` | **Tem** guarda `p_org_id <> user_org_id()`, mas o único call site (`getRankingData`) usa `createServiceRoleClient()`. Não precisa de `authenticated`. | 1019 service_role |
| `count_leads_opened_by_sdr_daily(p_org_id, ...)` | Idem. | 999 service_role |
| `pode_enviar_confirmacao(p_event_id, ...)` | Lê `confirmacoes_reuniao` sem org; vaza estado de reunião de qualquer org. | 11 service_role |
| `registrar_envio_confirmacao(...)` | INSERT/UPDATE livre em `confirmacoes_reuniao`. | 10 service_role |
| `registrar_disparo_no_show(...)` | INSERT/UPDATE livre em `no_show_disparos`. | 2 service_role |
| `registrar_qualidade_numero(...)` | INSERT livre em `numero_qualidade`. | nenhum |
| `registrar_status_mensagem(p_eventos)` e `registrar_status_mensagem(p_eventos, p_phone_number_id, p_display_phone_number)` | INSERT em `mensagens_status` + UPDATE em `confirmacoes_reuniao`. Duas assinaturas. | 3857 service_role |
| `sync_lead_meeting_starts_at(p_lead_id)` | UPDATE em `leads` de qualquer org. | nenhum |

### Higiene — funções de trigger

`RETURNS trigger` não é exposto pelo PostgREST, então o risco prático é nulo; o `EXECUTE` para PUBLIC
é só resíduo do default privilege. O Postgres não checa EXECUTE do invocador ao disparar um trigger
(a checagem acontece no `CREATE TRIGGER`), então revogar é seguro e deixa a auditoria limpa:
`callface_events_process`, `create_primary_contact_from_lead`, `enforce_enrollment_has_owner`,
`sync_primary_contact_to_lead`, `trg_meeting_starts_at`.

### Sales Hub — o caso que a análise estática erraria

Três funções expostas a `anon` **estão em uso**, com HTTP 200:

| Função | Chamadas anon (7d) | Problema |
|--------|-------------------|----------|
| `get_sdr_leads_abertos(p_year, p_month)` | 42 | Org V4 hardcoded; expõe e-mails de SDRs e volumetria. Sem qualquer guarda. |
| `get_sdr_atividades_atrasadas_v3(p_org_id)` | 35 | Recebe `p_org_id` e **não valida**; e-mails de SDRs de qualquer org. |
| `get_sdr_leads_para_abrir_v2(p_org_id)` | 34 | Idem. |

Revogar `anon` fecharia o buraco e derrubaria o Sales Hub. A decisão foi blindá-las com a guarda de
shared secret que as funções irmãs já usam — e o Sales Hub **já possui esse token**, porque chama
`get_leads_for_v4sales` com ele e recebe 200. A mudança do lado dele é acrescentar `p_api_token` ao
corpo da requisição.

## Scope

**IN:**

### 1. Migration A — revogar (`20260909210000_revoke_definer_exec_audit.sql`)

- `REVOKE EXECUTE ... FROM anon, authenticated, PUBLIC` nas 26 assinaturas classificadas (a) e (b),
  incluindo as 5 de trigger.
- `REVOKE ... FROM anon, PUBLIC` em `count_leads_by_loss_reason` e `set_primary_lead_contact`
  (mantêm `authenticated`).
- Limpeza do `=X/postgres` nas mantidas, com `GRANT` explícito a `anon`/`authenticated` logo em
  seguida, para que a permissão fique auditável em vez de herdada.
- **Não toca** em `user_org_id`, `is_manager`, `lead_visibility_mode`.
- Aplicável isoladamente: nenhuma das funções tem chamada `anon`/`authenticated` observada.

### 2. Migration B — blindar o Sales Hub (`20260909210100_harden_sdr_public_rpcs.sql`)

Arquivo **separado**, de aplicação coordenada com o time do Sales Hub, porque ativa uma guarda que
recusa a chamada atual (HTTP 403 até o token ser enviado).

- `DROP` + `CREATE` das 3 funções acrescentando `p_api_token text DEFAULT NULL` e a guarda
  `v_caller_org IS DISTINCT FROM v_org_id AND auth.role() <> 'service_role' AND NOT verify_api_secret('v4sales_public_rpc', p_api_token)` → `Forbidden` (42501).
- `get_sdr_atividades_atrasadas_v3` e `get_sdr_leads_para_abrir_v2` passam a validar `p_org_id`
  contra o chamador em vez de aceitá-lo cru.
- Cada `DROP`+`CREATE` é imediatamente seguido de `REVOKE ... FROM PUBLIC` + `GRANT` explícito —
  o padrão que esta story existe para institucionalizar.

### 3. Guarda contra reincidência

Três camadas, porque nenhuma sozinha resolve:

- **`supabase/security/definer-exec-allowlist.json`** — lista versionada das funções que *podem* ter
  EXECUTE para `anon`/`authenticated`, cada uma com a justificativa (helper de RLS, chamada do
  cliente com filtro de tenant, pública com shared secret).
- **`tests/security/definer-acl.test.ts`** — roda no CI (`pnpm test:run`, já no `ci.yml`), sem
  precisar de banco. Varre `supabase/migrations/*.sql` e falha quando um arquivo faz `DROP FUNCTION`
  + recria a função como `SECURITY DEFINER` sem um `REVOKE ... FROM ... PUBLIC` para a mesma função
  no mesmo arquivo. É exatamente o bug de `20260909184311`. Valida também a forma da allowlist.
- **`.claude/rules/dev-checkpoints.md`** — item novo no Checkpoint 1 exigindo o par
  `REVOKE`/`GRANT` em todo `DROP`+`CREATE` de `SECURITY DEFINER`, com a explicação de por que o
  `REVOKE` de uma migration antiga não vale.
- **`scripts/audits/definer-exec-audit.sql`** — query para reconferir `proacl` em prod contra a
  allowlist, para rodar depois de aplicar e em auditorias futuras.

**OUT:**

- Reescrever as funções críticas para receberem filtro de tenant. Revogar `anon`/`authenticated` já
  fecha a superfície; nenhuma delas é chamada por cliente. Se um dia precisarem ser, aí sim ganham
  guarda.
- `user_org_id`, `is_manager`, `lead_visibility_mode` — fora do escopo por definição.
- Mudança no repositório do Sales Hub (passar `p_api_token`) — é do outro lado, e a Migration B só
  deve ser aplicada quando ela estiver pronta.
- As 22 funções `prosecdef` que já estão apenas com `postgres` + `service_role`.

## Acceptance Criteria

1. **Given** a Migration A aplicada, **when** se consulta `has_function_privilege('anon'|'authenticated', oid, 'EXECUTE')` para as 64 funções `prosecdef` de `public`, **then** só retornam `true` as funções presentes em `definer-exec-allowlist.json`.
2. **Given** a Migration A aplicada, **when** se lê `proacl` de `user_org_id`, `is_manager` e `lead_visibility_mode`, **then** os grants para `authenticated`, `anon`, `authenticator` e `supabase_realtime_admin` continuam intactos.
3. **Given** a Migration A aplicada, **when** um usuário autenticado usa a lista de leads, a fila de atividades e o dashboard, **then** nada quebra — as 6 RPCs de cliente seguem respondendo.
4. **Given** a Migration A aplicada, **when** o cron e os fluxos n8n rodam com `service_role`, **then** nada quebra: `service_role` tem grant explícito em todas.
5. **Given** a Migration B aplicada, **when** o Sales Hub chama as 3 RPCs **com** `p_api_token` correto, **then** recebe 200; **when** chama **sem** o token e de fora da org V4, **then** recebe 403 (`42501`).
6. **Given** uma migration nova que faça `DROP`+`CREATE` de uma `SECURITY DEFINER` sem `REVOKE ... FROM PUBLIC` no mesmo arquivo, **when** o CI roda `pnpm test:run`, **then** o teste falha nomeando o arquivo e a função.
7. **Given** qualquer alteração na allowlist, **when** o CI roda, **then** o teste valida que cada entrada tem `reason` e `roles` preenchidos.

## Riscos

| Risco | Severidade | Mitigação |
|-------|-----------|-----------|
| Função chamada só mensalmente por `anon`/`authenticated` não apareceu na janela de 7 dias (retenção do plano) e quebra depois do revoke | Média | Decisão explícita do usuário de aceitar a margem. Reversão é um `GRANT EXECUTE ... TO authenticated;` — segundos. As 26 também não têm call site no código. |
| Migration B aplicada antes do Sales Hub passar o token | **Alta** | Por isso está em arquivo separado, com instrução explícita de aplicação coordenada. Não aplicar junto com a A. |
| `REVOKE ... FROM PUBLIC` remover acesso de um role interno do Supabase | Baixa | `postgres` e `service_role` têm grants explícitos em todas as 64; `supabase_admin` é superuser. Verificado em `proacl` antes e depois. |
| Revogar de função de trigger quebrar o trigger | Baixa | O Postgres checa EXECUTE no `CREATE TRIGGER`, não no disparo. Verificado no ensaio `BEGIN … ROLLBACK`. |

## Definition of Done

- [x] Levantamento completo das 64 funções `prosecdef`, com classificação e evidência de tráfego
- [x] Migration A escrita
- [x] Migration B escrita (aplicação coordenada)
- [x] Allowlist versionada
- [x] Teste de CI
- [x] Item no Checkpoint 1
- [x] Script de auditoria para reconferir em prod
- [x] Ensaio `BEGIN … ROLLBACK` da Migration A em prod
- [x] Migration A aplicada em prod — `20260909192822_revoke_definer_exec_audit`
- [x] `proacl` reconferido **depois** de aplicar (42/36 → 16/10, `service_role` intacto, 0 `proacl` NULL)
- [x] Advisors reconferidos: 42 → 16 e 36 → 10
- [x] Smoke test de permissão: 14/14 PASS
- [ ] Migration B aplicada (**requer o Sales Hub passar `p_api_token`**)
- [x] `pnpm typecheck && pnpm lint && pnpm test:run` verdes

## Dev Notes

- A ACL efetiva não se lê só pelos grants nominais: `=X/postgres` em `proacl` é o grant a PUBLIC, e
  PUBLIC inclui `anon` e `authenticated`. `copiloto_match_lead` e `copiloto_leads_qualificacao` não
  listam `anon=X` e ainda assim eram chamáveis por `anon`. Use sempre `has_function_privilege()`.
- Adicionar um parâmetro com `DEFAULT` **não** substitui a função: cria uma sobrecarga e deixa a
  antiga no ar, ainda exposta. Por isso a Migration B usa `DROP` + `CREATE`, e não
  `CREATE OR REPLACE`.
- Os logs do PostgREST por role saem de `edge_logs`, no caminho
  `metadata.request.sb[].jwt[].authorization[].payload[].role`. Foi o que separou "sem uso" de "em
  uso pelo Sales Hub" e evitou uma queda.
