# Story: Nomes de usuário em uma consulta (fim do getUserById por usuário)

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-04 | @dev (Dex) | Revisão adversarial (AJUSTAR): `pnpm gen:types` (regra do projeto) + chamada sem cast; `picture` também no fallback; mock antigo de `get-ranking-data.test.ts` trocado; `fetchAvatarMap` valida ids com zod. Única mudança visível em prod: card de tempo de resposta mostra `full_name` ("Rosolem") em vez de `name` ("Murilo Rosolem") para 1 manager — igual aos outros cards. |
| 2026-10-04 | @dev (Dex) | Migration `20261004160141_get_user_profiles` **aplicada em prod** (só service_role). Código migrado em ~20 pontos + testes. |
| 2026-10-04 | Vini + Claude | Story criada a partir da frente "lentidão nas telas" da auditoria de 04/out. Vini escolheu "Nomes de usuário". |

## Origem

A auditoria apontou índices em `leads`/`cadence_enrollments` como causa da lentidão, mas a medição real mostrou outra coisa:

- Os índices sugeridos **já existem**; "Leads para Abrir" responde em **26 ms** hoje. O `pg_stat_statements` acumula desde 17/04 e refletia problemas já corrigidos.
- Em 02/10 (sexta), 22 mil consultas de usuário logado: média 160 ms, p99 436 ms — **o banco está saudável**.
- O que pesa: **~5.600 chamadas/dia a `/auth/v1/admin/users/:id`** (~155 ms cada). `organization_members` não tem nome/e-mail, então ~20 lugares chamavam `auth.admin.getUserById` uma vez por usuário — inclusive o **layout autenticado, a cada navegação**. Três páginas de configuração faziam isso **em série** (13 membros × ~150 ms ≈ 2 s).

## Story

**As a** usuário da plataforma,
**I want** que as telas carreguem sem esperar uma chamada por colega de equipe,
**so that** a navegação fique mais rápida.

## Acceptance Criteria

1. Função `public.get_user_profiles(uuid[])` devolve `id, email, full_name (full_name > name), avatar_url (avatar_url > picture)` de `auth.users`; só `service_role` executa.
2. `resolveUserProfiles(ids)` em `src/lib/auth/user-directory.ts` resolve todos os ids numa chamada, deduplica por requisição (React `cache`), ignora vazios/não-UUID, nunca lança e cai no `getUserById` um-a-um se a função falhar.
3. Regra única de nome de exibição: `full_name || prefixo do e-mail || 8 primeiros chars do id`. Telas que mostravam o e-mail inteiro como fallback (configurações) mantêm essa regra.
4. Os pontos que resolviam vários usuários usam `resolveUserProfiles`/`resolveUserEmails`; buscas de usuário único ficam como estão.
5. Nomes iguais aos de antes (conferido em prod: 13/13 membros ativos, 0 diferenças).

## Resultado (medido contra prod, 13 membros ativos)

| | Antes | Depois |
|---|---|---|
| Chamadas por tela | 13 ao serviço de login | 1 ao banco |
| Layout (paralelo) | 156 ms | 40 ms |
| Telas de configuração (em série) | ~2 s | 40 ms |

## Scope

**IN:** migration, `user-directory.ts`, layout `(app)`, `calls/ajustes/daily-targets`, `settings/company/teams`, `settings/company/users`, `settings/users`, `settings/whatsapp-numbers`, Dashboard (`get-goals`, `get-ranking-data`, `get-response-time`, `get-sdr-pace-data`), `fetch-org-members`, `fetch-user-map` (+ `fetchAvatarMap`), `fetch-imports`, `fetch-interactions`, `get-daily-goals`, `statistics/member-lookup`, `meeting-reminders.service`, `meeting-webhook-dispatch.service`, `weekly-report.service`, `api/feedback` (e-mails de managers).

**OUT:** buscas de usuário único (vendedor do e-mail no motor, convite, briefing, CRM push); Dashboard `count_leads_opened_by_sdr` (624 ms média); consultas em série em Atividades/Leads/histórico do lead — frentes à parte.

## Notas de comportamento

- 1 usuário tem `name` diferente de `full_name`: o card de tempo de resposta (que preferia `name`) passa a mostrar `full_name`, igual aos demais cards.
- `get-ranking-data`/`get-sdr-pace-data` usavam `??` (um `full_name` vazio virava nome em branco); agora caem no prefixo do e-mail.
- `whatsapp-numbers`: `Date.now()` movido para `last24hIso()` — o React Compiler passou a analisar a função depois de sair o `try/catch` no laço.

## Tasks

- [x] Migration `get_user_profiles` + aplicar em prod + conferir permissões
- [x] `resolveUserProfiles` / `resolveUserEmails` + testes
- [x] Migrar os ~20 pontos
- [x] Comparar contra prod (nomes, tempo)
- [x] typecheck / lint / test:run / build
- [x] Revisão (ajustes aplicados)
- [x] `pnpm gen:types` (commit separado)
- [ ] PR

## File List

- `supabase/migrations/20261004160141_get_user_profiles.sql` (novo)
- `src/lib/auth/user-directory.ts` (modificado) · `src/lib/auth/user-directory.test.ts` (novo)
- `src/app/(app)/layout.tsx`, `src/app/(app)/calls/ajustes/daily-targets/page.tsx`, `src/app/(app)/settings/company/teams/page.tsx`, `src/app/(app)/settings/company/users/page.tsx`, `src/app/(app)/settings/users/page.tsx`, `src/app/(app)/settings/whatsapp-numbers/page.tsx`
- `src/features/dashboard/actions/{get-goals,get-ranking-data,get-response-time,get-sdr-pace-data}.ts`
- `src/features/leads/actions/{fetch-org-members,fetch-user-map,fetch-imports}.ts`, `src/features/leads/actions/fetch-org-members.test.ts`
- `src/features/cadences/actions/fetch-interactions.ts`
- `src/features/settings-prospecting/actions/get-daily-goals.ts`, `get-daily-goals.test.ts`
- `src/features/statistics/services/member-lookup.ts`
- `src/features/meeting-reminders/services/{meeting-reminders,meeting-webhook-dispatch,weekly-report}.service.ts`
- `src/app/api/feedback/route.ts`
- `src/features/dashboard/actions/get-ranking-data.test.ts` (mock do user-directory)
- `src/lib/supabase/types.ts` (regenerado — inclui drift de prod)
- `docs/stories/user-profiles-single-query.story.md` (novo)
