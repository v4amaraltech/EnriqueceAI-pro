# Story: Pacote de segurança P0 — fechar acesso público indevido

## Status
InProgress

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-04 | @dev (Dex) | Migration `20261004145223_security_p0_revoke_public_access` **aplicada em prod** e conferida: 0 das 5 funções e 0 das 8 views acessíveis por anon/authenticated (service_role mantém); 21/21 `_bkp_*` com RLS e sem anon; `get_sdr_*` intactas (Sales Hub). |
| 2026-10-04 | @dev (Dex) | Revisão adversarial (AJUSTAR): `sanitizeRedirect` normalizava `/.//evil.com` em `//evil.com` (redirect externo). Corrigido + testes. Migration, Pipedrive e Next aprovados. Upgrade do eslint-config-next trouxe 2 avisos `no-location-assign-relative-destination` → `router.push`. |
| 2026-10-04 | @dev (Dex) | Implementado (código + migration). |
| 2026-10-04 | Vini + Claude | Story criada a partir da auditoria de manutenção de 04/out (agentes de segurança e de banco). Vini escolheu atacar depois da detecção de respostas (PR #445). |

## Origem

Auditoria de 04/10/2026, conferida em produção:

- **Funções SECURITY DEFINER executáveis pela chave anon** (pública, vai em todo navegador):
  - `atualizar_convite_reuniao` — altera a reunião de **qualquer lead de qualquer org**, sem checar org. Criada direto em prod, fora do repo.
  - `claim_email_conversation`, `renew_email_conversation_lock`, `release_email_conversation_lock` — anon trava a conversa do agente BDR para sempre ou solta a trava de outro executor (migration `bdr3` sem REVOKE).
- **8 views SECURITY DEFINER** legíveis por anon/authenticated, ignorando RLS. `vw_sla_qualificacao_sdr` expunha `auth.users`.
- **17 tabelas `_bkp_*` sem RLS**, legíveis por anon (dados de leads).
- **Callback real do Pipedrive** (`/API/v2/callback`) não validava o `state` — a correção de 17/ago só cobriu `/api/auth/callback/pipedrive`. Um link armado conecta o Pipedrive do atacante na org de um gestor logado.
- **Open redirect no callback do Gmail**: `sanitizeRedirect` aceitava `/\evil.com` (navegador trata `\` como `/`).
- **Next.js 16.3.1** com 3 vulnerabilidades críticas (RCE) — corrigidas na 16.3.6.

## Story

**As a** gestor de uma org cliente,
**I want** que dados e ações da plataforma só sejam acessíveis pela aplicação, com login e escopo da minha org,
**so that** ninguém de fora (ou de outra org) leia meus leads ou mexa nas minhas reuniões e integrações.

## Acceptance Criteria

1. `anon` e `authenticated` não executam `atualizar_convite_reuniao`, as 3 funções de trava do BDR nem `trg_dispatch_log_registra_confirmacao`; `service_role` executa.
2. `anon` e `authenticated` não leem as 8 views SECURITY DEFINER; `service_role` lê (n8n e app seguem funcionando).
3. Todas as `_bkp_*` com RLS ligado e sem acesso de `anon`/`authenticated`.
4. `/API/v2/callback` recusa (sem trocar o `code`) quando o `state` não confere com o cookie emitido.
5. O callback do Gmail só redireciona para caminho do próprio app (rejeita `\`, `//`, esquemas, origem diferente).
6. `next` ≥ 16.3.6; `pnpm audit --prod` sem críticas.
7. Nenhum consumidor quebra: uso conferido nos `edge_logs` antes de revogar.

## Scope

**IN:** migration de REVOKE/RLS, `src/app/api/v2/callback/route.ts`, `src/lib/security/safe-redirect.ts`, upgrade do Next, testes.

**OUT:**
- `get_sdr_atividades_atrasadas_v3`, `get_sdr_leads_para_abrir_v2`, `get_sdr_leads_abertos` — o Sales Hub chama com anon pelo navegador; só revogar quando ele mandar `p_api_token` (migration `20260909210100`, pendente).
- Teste de ACL no CI (`definer-acl.test.ts`, commit WIP `f48abfed`, não revisado) — próxima story.
- Pipedrive: conexão precisa começar pelo botão em Configurações → Integrações (instalação direta pelo link do app privado agora dá `oauth_state_mismatch`, por design).
- Guarda automática para backups futuros nascerem com RLS (event trigger) — próxima story.
- Achados de segurança do BDR IA (caixa de e-mail com `ilike` sem escape, meeting-requests sem filtro de org) e demais itens médios/baixos da auditoria.

## Uso conferido (edge_logs, 02–04/10)

| Objeto | Quem chama |
|---|---|
| `v_meeting_webhook_candidates` | service_role (app) |
| `vw_no_show_para_ligar`, `vw_no_show_para_remarcar`, `vw_confirmacao_ligacao_hoje` | service_role (n8n) |
| demais views, funções de trava, `atualizar_convite_reuniao`, `_bkp_*` | nenhum cliente REST |
| `get_sdr_*` | anon pelo navegador (Sales Hub) → fora do pacote |

## Tasks

- [x] Migration REVOKE/RLS
- [x] `/API/v2/callback` valida `state` + testes
- [x] `sanitizeRedirect` em `lib/security/safe-redirect.ts` + testes
- [x] Next 16.3.8 (lock com binários linux conferido; `pnpm audit --prod` sem críticas)
- [x] typecheck / lint / test:run / build
- [x] Aplicar migration em prod + conferir com `has_function_privilege` / `has_table_privilege`
- [ ] PR + deploy

## File List

- `supabase/migrations/20261004145223_security_p0_revoke_public_access.sql` (novo)
- `src/features/integrations/components/ScheduleMeetingModal.tsx`, `src/features/leads/components/LeadScheduleTab.tsx` (`router.push` — aviso novo do eslint-config-next)
- `src/app/api/v2/callback/route.ts` (modificado)
- `src/app/api/v2/callback/route.test.ts` (novo)
- `src/app/api/auth/callback/gmail/route.ts` (modificado)
- `src/lib/security/safe-redirect.ts` (novo)
- `src/lib/security/safe-redirect.test.ts` (novo)
- `package.json`, `pnpm-lock.yaml` (next 16.3.8)
- `docs/stories/security-p0-public-access.story.md` (novo)
