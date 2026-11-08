# Story: Funções do Sales Hub exigem token (sem acesso anônimo)

## Status
InProgress (fase 2 em PR, aguardando revisão)

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-13 | Vini + Claude | Story criada a partir da revisão da story `business-holidays` (PR #470). |
| 2026-11-08 | Claude (@dev) | Fase 1 já aplicada (`20261108130000_security_medium_2_19.sql`, PR #540). Fase 2 implementada para `_v4` e `_v2`: migration `20261108180000_sdr_hub_rpcs_require_token.sql` remove o ramo anon sem token. `get_sdr_leads_abertos` fica para mudança separada. |
| 2026-11-08 | Claude (@dev) | `get_sdr_leads_abertos`, passo 1 de 3: criada `get_sdr_leads_abertos_v2(p_year, p_month, p_api_token)` (migration `20261108190000`), com o mesmo JSON e protegida. A legada não muda. |

## Origem

Três funções do banco usadas pelo Sales Hub respondem para **qualquer pessoa com a chave pública (anon)** do Supabase, sem login e sem token. Todas são `SECURITY DEFINER` (passam por cima do RLS):

| Função | O que devolve | Filtro de org |
|---|---|---|
| `get_sdr_atividades_atrasadas_v4(p_org_id)` | e-mail de cada SDR + nº de atrasadas | **qualquer** `p_org_id` informado |
| `get_sdr_leads_para_abrir_v2(p_org_id)` | e-mail de cada SDR + nº de leads na fila | **qualquer** `p_org_id` informado |
| `get_sdr_leads_abertos(p_year, p_month)` | leads abertos por SDR (jsonb) | org V4 Amaral fixa |

- A chave anon é pública (vai no navegador). Quem tiver o UUID de uma org lê os e-mails dos SDRs dela; a terceira expõe números da V4 sem precisar de nada.
- Uso real (edge_logs, 13/10): as três são chamadas pelo Sales Hub com papel `anon`, HTTP 200. **Não dá para só revogar**: o card do Sales Hub cai.
- O padrão certo já existe: `get_leads_for_v4sales(p_api_token, ...)` exige `verify_api_secret('v4sales_public_rpc', p_api_token)` (ou `service_role`, ou usuário logado da própria org). O Sales Hub **já tem** esse token.
- Já houve um plano (09/09, migration `20260909210100_harden_sdr_public_rpcs.sql`, branch `claude/relaxed-noyce-21b9e0`, sem PR) que nunca foi aplicado. Está **desatualizado**: cobre a `_v3` (hoje é `_v4`) e tem um corpo antigo de `get_sdr_leads_para_abrir_v2`. Não reaproveitar sem refazer.

## Story

**As a** dono da plataforma,
**I want** que as funções do Sales Hub só respondam com o token do Sales Hub,
**so that** ninguém de fora leia e-mails de SDR ou números de outra empresa.

## Acceptance Criteria

1. **Fase 1 (sem quebrar):** as três funções ganham `p_api_token text DEFAULT NULL` como último parâmetro. Como muda a assinatura, é `DROP` + `CREATE` (não `CREATE OR REPLACE`, que criaria uma sobrecarga e deixaria a antiga exposta) + grants explícitos. Corpo atual preservado (a `_v4` com `overdue_cutoff_brt()` da story `business-holidays`; a `_v2` lendo `leads_no_active_enrollment`). Sem token, ainda funciona, mas grava um aviso (para medir quem ainda chama sem token).
2. **Sales Hub** passa a enviar `p_api_token` nas três chamadas (mudança no repositório do Sales Hub; validar pelo `/version.json` dele).
3. **Fase 2 (trava):** sem token válido → `42501 Forbidden`, exceto `service_role` ou usuário logado da própria org (mesma regra de `get_leads_for_v4sales`). `get_sdr_atividades_atrasadas_v4` e `get_sdr_leads_para_abrir_v2` passam a recusar `p_org_id` diferente da org do token.
4. Conferência por papel nos `edge_logs` (retenção 7 dias) antes da fase 2: zero chamadas sem token nos últimos dias.
5. `supabase/security/definer-exec-allowlist.json` e `tests/security/definer-acl.test.ts` atualizados; `has_function_privilege()` confirma que `anon` só passa com token.
6. `pnpm gen:types` no PR de cada fase (assinatura muda).

## Scope

**IN:** as três funções acima; allowlist/teste de ACL; coordenação com o Sales Hub.

**OUT:** `list_overdue_activities_brt` / `list_overdue_enrollments_brt` / `overdue_cutoff_brt` / `is_business_day_brt` (executáveis por anon, mas sem `SECURITY DEFINER` ou sem dado sensível: com anon o RLS não deixa ler nada); demais RPCs do Sales Hub já protegidas.

## Riscos

- Aplicar a fase 2 antes do Sales Hub mandar o token derruba os cards dele (403). Por isso as duas fases.
- `DROP` + `CREATE` de função `SECURITY DEFINER` volta a dar EXECUTE para `authenticated`/PUBLIC — conferir `proacl` / `has_function_privilege()` depois (lição de 09/09).
- O repo passou a ser dono da `_v4` (PR #470). Se o Sales Hub recriar a função por conta própria, desfaz esta proteção e a regra de feriados.

## Complexidade
P–M (SQL simples; o custo é a coordenação com o Sales Hub).

## Tasks
- [ ] Validar story (@po)
- [x] Fase 1: migration + tipos (`20261108130000`, PR #540)
- [x] Sales Hub envia `p_api_token` (Edge Function `sdr-enriquece-metrics`, informado em 08/11)
- [ ] Conferir edge_logs (só chamadas com token)
- [x] Fase 2: exigir token em `_v4` e `_v2` (assinatura igual → `types.ts` sem mudança)
- [ ] Aplicar a migration da fase 2 em prod após o merge e rodar a verificação do cabeçalho dela
- [ ] `get_sdr_leads_abertos(integer,integer)` em 3 passos:
  - [x] 1. Criar o caminho protegido `get_sdr_leads_abertos_v2` (aditivo; a legada fica igual)
  - [ ] 1b. Aplicar a migration `20261108190000` em prod e rodar `pnpm gen:types` (`chore(types)`)
  - [ ] 2. Hub: trocar o consumidor direto pelo proxy servidor chamando a `_v2` com token; validar tráfego real (`edge_logs`)
  - [ ] 3. Bloquear a legada (REVOKE de PUBLIC/anon/authenticated) em PR próprio

## Dev Notes (fase 2)

- Só `get_sdr_atividades_atrasadas_v4(uuid,text)` e `get_sdr_leads_para_abrir_v2(uuid,text)`. Corpo igual ao da fase 1 menos o ramo `ELSIF auth.role() = 'anon'`.
- `CREATE OR REPLACE` (mesma assinatura): mantém default, ACL e retorno. anon mantém EXECUTE — o proxy do Hub usa chave anon + token.
- **Fora desta fase:** `get_sdr_leads_abertos(integer,integer)` (SECURITY DEFINER, sem token, anon, agregados com e-mails; o Hub ainda chama direto), RPCs de indicações e `get_leads_for_v4sales`.
- Abas antigas do Hub (abertas antes do proxy) precisam recarregar.
- Itens 4 e 5 dos AC (edge_logs e allowlist/`definer-acl.test.ts`) não foram feitos aqui: a allowlist e o teste de ACL não existem na `main`; a cobertura de permissão está no teste de integração.

## File List (fase 2)

- `supabase/migrations/20261108180000_sdr_hub_rpcs_require_token.sql` (novo)
- `src/features/leads/sdr-hub-rpcs-require-token-migration.test.ts` (novo)
- `tests/integration/sdr-hub-rpcs-token.test.ts` (novo)
- `tests/integration/fixtures/sdr-hub-rpcs-schema.sql` (novo)
- `docs/stories/sales-hub-sdr-rpcs-token.story.md`

## Dev Notes (`get_sdr_leads_abertos_v2`)

- A legada existe só em prod. O corpo foi copiado (só leitura, 08/11) para `tests/integration/fixtures/sdr-leads-abertos-legacy.sql`; o teste confere o md5 de prod (`b899208067dcb769ccca919238c65a6d`).
- A `_v2` tem o mesmo cálculo, JSON, fuso e org fixa. Muda só a checagem de chamador no começo e o `search_path = ''`, com nomes qualificados. `v_start`/`v_end` agora são calculados depois da checagem: quem não está autorizado recebe 42501, não erro de data.
- Quem passa: service_role, usuário ativo da org V4 (`user_org_id()`) ou token válido. Token válido autoriza qualquer chamador, inclusive usuário de outra org, igual às outras RPCs com token.
- Este passo **não** fecha a exposição: a legada continua aberta a anon sem token.
- `leads_opened_events`: o repo tem comentários que prod não tem; o código sem comentários é idêntico (conferido no teste).

## File List (`get_sdr_leads_abertos_v2`)

- `supabase/migrations/20261108190000_get_sdr_leads_abertos_v2_token.sql` (novo)
- `src/features/leads/sdr-leads-abertos-v2-migration.test.ts` (novo)
- `tests/integration/sdr-leads-abertos-v2.test.ts` (novo)
- `tests/integration/fixtures/sdr-leads-abertos-legacy.sql` (novo)
- `docs/stories/sales-hub-sdr-rpcs-token.story.md`
