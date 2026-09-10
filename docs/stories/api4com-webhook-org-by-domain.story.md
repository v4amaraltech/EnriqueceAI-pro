# Story: Webhook API4COM identifica a org pelo domínio da conta, não pelo ramal

## Status
Ready for Review

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-10 | @dev (Dex) | Draft → InProgress → **Ready for Review**. Implementado sem migration (reusa `api4com_connections.sip_domain`). typecheck ✅ lint ✅ testes ✅ (+8). Nada commitado (regra git manual). |
| 2026-09-10 | Vini + Claude | Story criada. Pré-requisito para ligar o webhook da org V4 Company Julio Cesar (ver `call-effectiveness-view.story.md`, Nota 3). Opção aprovada pelo Vini: "corrige pelo domínio". |

## Executor Assignment
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["vitest", "typecheck", "lint"]

## Origem

Cada unidade tem a própria conta API4COM, e os **números de ramal se repetem entre contas**: em 10/set/2026, 1024 e 1028 existem na V4 Amaral **e** na conta do Julio Cesar (ramais do Julio que não estão no app). O webhook `/api/webhooks/api4com` casava e criava ligações só pelo ramal, sem org:

- **fallback de casamento** (`origin = caller` + destino, 2h) — podia ligar o evento de uma conta a uma ligação da outra org;
- **criação automática** (ligação feita fora do discador) — resolvia a org por `api4com_connections.ramal` → um evento do ramal 1024 do Julio seria criado na Amaral;
- o worker `back-associate-api4com-webhooks` tinha o mesmo casamento por ramal.

Hoje isso não acontece só porque o webhook do Julio nunca chegou (filtro de gateway — ver story `call-effectiveness-view`). Consertar o webhook dele sem isto misturaria dados das duas orgs.

O payload traz `domain` (`v4amaral.api4com.com` em 100% dos eventos de 2 dias), que é o mesmo valor que a org guarda em `api4com_connections.sip_domain` (domínio SIP, por conta — já tratado como "igual para todos os SDRs da org" em `get-api4com-sip-credentials.ts`). Amaral já tem esse valor no ramal 1014; Julio ainda não.

## Story

**As a** gestor de uma unidade,
**I want** que as ligações da minha conta API4COM só caiam na minha org,
**so that** ramal com o mesmo número em outra unidade não misture dados.

## Complexity
**S** — sem migration; 1 módulo puro, 2 rotas ajustadas, diagnóstico passa a mostrar o domínio.

## Scope

**IN:**
1. `features/integrations/services/api4com-org-scope.ts` (puro): `resolveApi4ComOrgScope(connections, domain)` e `pickApi4ComConnectionForRamal(...)`.
   - org com alguma conexão cujo `sip_domain` = `domain` do evento → só ela;
   - domínio desconhecido → só orgs **ainda sem** domínio cadastrado (comportamento antigo, restrito); org já mapeada nunca recebe domínio alheio;
   - todas mapeadas + domínio desconhecido → ninguém (só o casamento por id segue).
2. Webhook: fallback por ramal com `.in('org_id', escopo)`; criação automática escolhe a conexão do ramal dentro do escopo (ambíguo → não cria).
3. Worker `back-associate-api4com-webhooks`: mesmo escopo no casamento.
4. Diagnóstico `check-api4com-config`: passa a mostrar `accountDomain` (`metadata.domain` da integração `sippulse`) — é daí que sai o domínio do Julio.

**OUT:**
- Cadastrar o `sip_domain` do Julio Cesar (operação em prod, depois do deploy, com o valor lido no diagnóstico).
- Configurar a integração `webhook` da API4COM do Julio (depois disto).
- Cron `reregister-api4com-webhooks` sobrescrevendo a `webhookUrl` da integração de CRM (achado da story `call-effectiveness-view`).
- Preencher `sip_domain` automaticamente ao conectar.

## Acceptance Criteria
- [x] AC1 — Evento com `domain` da Amaral só casa/cria em ligações da Amaral.
- [x] AC2 — Evento de domínio desconhecido nunca cai numa org que já tem domínio cadastrado.
- [x] AC3 — Ramal repetido entre orgs: a criação automática usa a conexão da org do escopo; se ambíguo, não cria.
- [x] AC4 — Sem nenhuma org mapeada, o comportamento é o de antes (não quebra quem ainda não cadastrou o domínio).
- [x] AC5 — Diagnóstico mostra o domínio da conta por ramal.

## Tasks
- [x] T1 — módulo `api4com-org-scope.ts` + testes
- [x] T2 — webhook `/api/webhooks/api4com`
- [x] T3 — worker `back-associate-api4com-webhooks`
- [x] T4 — `accountDomain` no diagnóstico + teste
- [x] T5 — typecheck, lint, testes, build

## Risks
- Org sem `sip_domain` segue no modo antigo entre si. Com 2+ orgs sem domínio e ramal repetido, a criação automática fica ambígua e não cria (não mistura). Mitigação: cadastrar o domínio de toda org com API4COM.
- Uma consulta a mais (`api4com_connections`, ~10 linhas) por evento.

## Dev Agent Record
### File List
- `docs/stories/api4com-webhook-org-by-domain.story.md` (novo)
- `src/features/integrations/services/api4com-org-scope.ts` (novo) + `api4com-org-scope.test.ts` (novo, 8 testes)
- `src/app/api/webhooks/api4com/route.ts`
- `src/app/api/workers/back-associate-api4com-webhooks/route.ts`
- `src/features/integrations/services/api4com-diagnostics.ts` + `.test.ts` — `accountDomain`

### Próximos passos (depois do deploy)
1. `POST /api/admin/check-api4com-config {orgId: Julio}` → ler `accountDomain`.
2. `UPDATE api4com_connections SET sip_domain = '<domínio>' WHERE org_id = '0bbf24f6…' AND sip_domain IS NULL` (autorização do Vini).
3. Configurar a integração `webhook` da API4COM do Julio (URL certa do n8n) — autorização do Vini.

## QA Results
_(pendente)_
