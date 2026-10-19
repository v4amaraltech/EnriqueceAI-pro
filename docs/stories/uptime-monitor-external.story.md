# Story: Monitor de disponibilidade externo ao host (aviso quando o site cai)

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-19 | Vini + Claude | Segredo `resend_api_key` criado no Vault (1ª vez com o texto de exemplo; corrigido com `vault.update_secret`). Teste manual em prod: URL inválida → 2 rodadas → e-mail "fora do ar" enviado (Resend 200) + sino; URL de volta → e-mail "voltou" (Resend 200) + sino. PR #482 aberto. |
| 2026-10-19 | Claude (com OK do Vini) | Migration aplicada em prod via MCP (versão `20261019132752`), cron `uptime-monitor` ativo (jobid 66, 1ª rodada 13:28 UTC ok em 300 ms), tipos regenerados. Falta a chave do Resend no Vault e o teste manual com e-mail. |
| 2026-10-19 | Vini + Claude | Story criada após a queda de 19/10 (Contabo reiniciou o host, ~30 min fora, ninguém avisado). Migration escrita e ensaiada em prod dentro de transação com rollback (não aplicada). |

## Origem

- 19/10/2026, 08:48–09:18 BRT: Cloudflare 523 em `app.enriqueceai.com.br`. Causa: a Contabo reiniciou o host físico (`vps-cerebro`) para patch de kernel. Tudo voltou sozinho, mas **ninguém da equipe foi avisado**.
- Os alertas de "robô parado" (`health-check-workers` → Sentry + sino) rodam **dentro do app, no mesmo host**. Quando o host inteiro cai, eles caem junto.
- O banco de produção é Supabase cloud (projeto `dhkmonctyoaenejemkrt`), fora desse host, com `pg_cron` e as extensões `pg_net` e `http` já instaladas.

## Story

**As a** time de produto / gestor da V4 Amaral,
**I want** ser avisado em poucos minutos quando o site parar de responder, por um canal que não dependa do site,
**so that** a queda dure o tempo de alguém agir, não o tempo de alguém perceber.

## Acceptance Criteria

1. Um job `pg_cron` chamado `uptime-monitor` roda **a cada 2 min no Supabase cloud** e faz `GET https://app.enriqueceai.com.br/api/version` com a extensão `http` (síncrona: status + latência na hora). Sem segredo no comando do cron (chama função do próprio banco).
2. Uma rodada é **OK** quando responde HTTP 200 e o corpo contém `"status":"ok"`. Qualquer outra coisa (523, 5xx, timeout, DNS, corpo estranho) é falha. Se a 1ª tentativa falha, espera 10 s e tenta de novo na mesma rodada antes de contar a falha.
3. Cada rodada grava uma linha em `uptime_checks` (`checked_at`, `ok`, `status_code`, `latency_ms`, `attempts`, `error`). Retenção: 30 dias (o próprio cron apaga).
4. Após **2 rodadas seguidas falhando** (~4 min) → aviso **"fora do ar"**. Enquanto segue fora, **lembrete a cada 60 min**. Quando responde OK de novo → aviso **"voltou"** com a duração da queda.
5. Canais do aviso, nenhum dependente do app:
   - **E-mail** via Resend (`POST api.resend.com/emails` direto do banco). Chave lida do **Vault** (`resend_api_key`), nunca do git. Destinatários: `uptime_monitors.alert_emails`; se nulo, os **gestores ativos** da org `notify_org_id` (V4 Amaral). Sem a chave no Vault, o e-mail é pulado e o motivo fica gravado em `uptime_checks.alert_detail`.
   - **Sino do app** (`notifications`, tipo `integration_error`, mesmo canal do health-check) para os gestores da org — aparece quando o app voltar; serve sobretudo para o "voltou".
6. Tabelas `uptime_monitors` e `uptime_checks` com RLS: leitura só para gestores da org avisada; `anon` sem nenhum acesso; escrita só `service_role`/`postgres`. Funções com `REVOKE` de `PUBLIC/anon/authenticated`.
7. Rodadas não se sobrepõem (advisory lock) e a função devolve um resumo JSON para rodar na mão.
8. Tipos regenerados (`pnpm gen:types`) no mesmo PR da migration.

## Scope

**IN:** migration `20261019130000_uptime_monitor_external.sql` (tabelas, RLS, 3 funções, seed do monitor, cron), tipos, esta story, roteiro de teste manual.

**OUT:** tela no app para ver o histórico; aviso por WhatsApp (n8n fica no `vps-callcenter`, 154.38.162.170 — outro host, viável como canal futuro via webhook); monitorar Sales Hub / Supabase self-hosted do mesmo VPS (basta inserir outra linha em `uptime_monitors`); vigiar o próprio pg_cron (se o Supabase parar, o monitor para junto — risco aceito).

## Decisões

- **`http` síncrono em vez de `pg_net`:** na fila do `pg_net` ~13% das chamadas das últimas 24 h morreram em "DNS time: 5000 ms" e outras ~10% no timeout de 5 s. Com 2 rodadas como gatilho, isso daria dezenas de alarmes falsos por dia. A extensão `http` respondeu 8/8 em ~200 ms no teste, dá status e latência na hora e permite retentativa na mesma rodada. Rodada com falha leva no máximo ~35 s (2 × timeout 10 s + 10 s de espera), bem abaixo dos 2 min do cron.
- **Cache-buster** `?probe=<epoch>` + `Cache-Control: no-cache`: nunca aceitar resposta guardada (Cloudflare marca a rota como `DYNAMIC`, mas não custa).
- **Tabelas globais de plataforma** (sem `org_id`, como `app_flags`): o monitor vigia a plataforma, não um tenant. `notify_org_id` diz quem é avisado.
- **Chave do Resend no Vault**, não na migration nem em `app_flags`: migration vai pro git.

## Tasks

- [x] Validar em prod (somente leitura): `http` ext funciona, falha lança erro claro, Vault acessível, gestores da V4 Amaral têm e-mail, `n8n` não está no host do Coolify.
- [x] Migration: tabelas + RLS/REVOKE + `uptime_probe` + `uptime_send_alert` + `uptime_monitor_tick` + seed + cron idempotente.
- [x] Ensaio da migration em prod dentro de `BEGIN … ROLLBACK` (sem o cron): rodada OK, 2 falhas → "down" (sino criado, e-mail pulado por falta da chave), URL de volta → "recovered".
- [x] Aplicar a migration em prod via MCP (`apply_migration`) — 19/10 13:27 UTC, versão `20261019132752`.
- [x] **Vini:** criar o segredo no Vault (SQL Editor, não no chat): `select vault.create_secret('<chave do Resend>', 'resend_api_key', 'Resend — alertas de uptime');` — feito 19/10 15:04 UTC (trocar o valor depois: `vault.update_secret('<id>', '<chave>')`).
- [x] `pnpm gen:types` (+237 linhas, só adições; também entraram objetos já em prod sem tipo: `bdr_cadence_links`, `bdr_ultimo_engajamento_email`, `begin_email_step`, `confirm_email_step`, `consentimento_alimentar_inbound`) + `pnpm typecheck && pnpm lint`.
- [x] Teste manual (abaixo) com o alerta chegando por e-mail — 19/10 15:05 UTC: `down` e `recovered` com `email.sent = true` (Resend 200) e `bell.count = 1`.
- [x] Commit / PR — PR #482 (`a861ae97` + `62faab81`).
- [ ] Mesclar após CI verde (`gh pr merge --squash`), story → Done, remover worktree.

## Teste manual

Tudo via MCP Supabase / SQL Editor, sem derrubar nada:

```sql
-- 0. Estado inicial: deve responder ok=true, status 200, ~200 ms
select public.uptime_monitor_tick();

-- 1. Simular queda: apontar para uma rota que não existe (404)
update public.uptime_monitors set url = 'https://app.enriqueceai.com.br/api/nao-existe' where name = 'enriqueceai-app';

-- 2. Duas rodadas (ou esperar 4 min do cron). A 2ª devolve alert = 'down'
select public.uptime_monitor_tick();   -- consecutive_failures = 1, sem aviso
select public.uptime_monitor_tick();   -- alert = 'down' → e-mail (status 200 do Resend) + sino

-- 3. Conferir o que foi gravado
select checked_at, ok, status_code, latency_ms, attempts, error, alert_kind, alert_detail
from public.uptime_checks order by id desc limit 5;

-- 4. Voltar a URL: a próxima rodada devolve alert = 'recovered' (e-mail "voltou" com a duração)
update public.uptime_monitors set url = 'https://app.enriqueceai.com.br/api/version' where name = 'enriqueceai-app';
select public.uptime_monitor_tick();

-- 5. Sino: 1 notificação 'down' + 1 'recovered' por gestor da V4 Amaral
select title, body, created_at from public.notifications where resource_type = 'uptime' order by created_at desc limit 4;

-- 6. Cron vivo? (status 'succeeded' a cada 2 min)
select start_time, status, left(return_message, 120) from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'uptime-monitor') order by start_time desc limit 5;
```

Teste real de rede (opcional, fora do horário): `ssh vps-cerebro 'docker stop coolify-proxy'` por ~5 min e depois `docker start coolify-proxy` — o monitor deve ver 523 e mandar "fora do ar" e "voltou".

Para trocar os destinatários sem mexer em código: `update public.uptime_monitors set alert_emails = array['a@v4company.com','b@v4company.com'] where name = 'enriqueceai-app';` (nulo = gestores da org).

## Dev Notes

- Resultado do ensaio (19/10, prod, `BEGIN … RAISE EXCEPTION`, nada gravado): rodada OK em 193 ms; URL inexistente → o app responde **HTTP 200 com HTML** (página de login), e só a checagem do corpo (`%"status":"ok"%`) classificou como falha — por isso ela não pode ser desligada; 2ª falha → `alert = 'down'` com `bell.count = 1` e `email.sent = false` ("segredo resend_api_key não existe no Vault", 1 destinatário encontrado); lembrete e "voltou" OK; `anon` sem SELECT nas tabelas e sem EXECUTE nas funções; `authenticated` só SELECT.
- A MCP do Supabase embrulha cada `execute_sql` numa transação só: para ensaiar sem gravar, termine com `RAISE EXCEPTION` carregando os resultados (um `ROLLBACK` no meio apaga até a tabela temporária com eles).
- `pnpm gen:types` lê o banco remoto: só gera as tabelas novas depois de a migration estar aplicada em prod.

## File List

- `supabase/migrations/20261019130000_uptime_monitor_external.sql` (novo)
- `src/lib/supabase/types.ts` (regenerado)
- `docs/stories/uptime-monitor-external.story.md` (novo)
