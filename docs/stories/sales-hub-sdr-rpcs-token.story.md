# Story: Funções do Sales Hub exigem token (sem acesso anônimo)

## Status
Draft

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-13 | Vini + Claude | Story criada a partir da revisão da story `business-holidays` (PR #470). |

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
- [ ] Fase 1: migration + tipos + teste de ACL
- [ ] Sales Hub envia `p_api_token`
- [ ] Conferir edge_logs (só chamadas com token)
- [ ] Fase 2: exigir token + tipos
