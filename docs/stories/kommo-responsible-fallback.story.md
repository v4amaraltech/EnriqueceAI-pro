# Story: Card do Kommo nasce sempre com o closer como responsável

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-30 | @dev (Dex) | Implementado + testado (worktree `brave-wozniak-803feb`, nada commitado — o usuário decide). |
| 2026-10-30 | Vini + Claude | Story criada a partir do caso NEXT360 Telecom (29–30/10). |

## Origem

- Regra do CRM: lead com closer só ganha card no Kommo quando o closer responde "Realizada" (`pushConfirmedMeetingToCrm`), usando `metadata.crm_options` da interação `lead_won` gravada pelo modal de Ganho e caindo nos padrões da conexão (`crm_connections.default_*`).
- O modal pré-seleciona o responsável casando o e-mail do closer com a lista `kommoUsers`, que chega de forma **assíncrona**. Se o SDR confirma antes da lista chegar, ou se a chamada falha, `crm_options` é gravado **sem `responsibleUserId`**.
- `KommoAdapter.pushDeal` só manda `responsible_user_id` quando recebe; sem ele o Kommo atribui o card ao **dono do token da integração** (Vini).
- Caso real 29/10/2026: lead **NEXT360 Telecom Ltda** (`74fdbd11-63fc-42c6-bf74-a225ef695610`, SDR Matheus, closer Jhonata Banqueri) foi o único `lead_won` recente com `crm_options` sem responsável; o card 26624607 nasceu 30/10 com o Vini em vez do Jhonata (usuário Kommo 15013532). `default_responsible_user_id` da org V4 Amaral é null.

## Story

**As a** gestor / closer,
**I want** que o card do Kommo nasça com o closer da reunião como responsável, mesmo quando o modal de Ganho não gravou o responsável,
**so that** o card nunca caia no dono do token da integração por acidente.

## Acceptance Criteria

1. **Fallback no servidor** (`pushLeadToCrm`, provider `kommo`): ordem de resolução do responsável
   1. `crmOptions.responsibleUserId` explícito (modal) — desde que diferente do padrão da conexão, porque os chamadores sem modal (`pushLeadToCrmWithDefaults`, `markDealWonInCrm`) repassam o padrão nesse mesmo campo;
   2. usuário do Kommo cujo e-mail bate (sem diferenciar maiúsculas/espaços) com `closers.email` do `leads.closer_id`;
   3. `crm_connections.default_responsible_user_id`;
   4. nenhum (comportamento antigo), com `console.warn` contendo o `leadId`.
2. A lista de usuários do Kommo é consultada **só quando há closer** e fica em **cache curto por org** (5 min) para não bater em `/users` a cada push.
3. Qualquer erro ao consultar closer/usuários **não derruba o push**: cai no padrão da conexão e vai para o log.
4. **Modal de Ganho**: com envio ao Kommo ligado, o botão "Confirmar ganho" fica desabilitado enquanto `kommoUsers` carrega; se a lista falhar ou vier vazia, o modal avisa que o responsável será o closer (resolvido pelo servidor) e libera a confirmação.
5. Testes Vitest: resolve pelo e-mail do closer; cai no padrão quando não casa; respeita `responsibleUserId` explícito; sem closer não consulta usuários; explícito igual ao padrão não vence o closer; erro na lista cai no padrão; cache por org expira; fluxo completo por `pushLeadToCrm` (4 casos).
6. `pnpm typecheck`, `pnpm lint` e `pnpm exec vitest run` nos arquivos tocados passam.

## Scope

**IN:** `crm-push.service.ts` (branch Kommo de `pushLeadToCrm`), novo `crm-responsible.ts`, modal de Ganho em `LeadDetailLayout.tsx`, testes, esta story.

**OUT:** corrigir à mão o card 26624607 no Kommo (o usuário faz na interface do Kommo); mover deal para a etapa 142; retry/reconciliação do push (PR #507, `kommo-push-retry-reconcile.story.md`); `fetchKommoUsers` (server action do modal) continua sem cache.

## Decisões

- **Arquivo novo + 1 hunk em `crm-push.service.ts`**: o PR #507 muda as assinaturas (`pushLeadToCrm(orgId, leadId, crmOptions, retry)`) e o topo dos imports; o import novo entrou junto dos `@/lib` e a resolução ficou dentro do branch Kommo (que o #507 não toca), para mesclar sem conflito.
- **Explícito igual ao padrão da conexão não vence o closer**: `pushLeadToCrmWithDefaults`/`markDealWonInCrm` entregam `default_responsible_user_id` como se fosse explícito; sem essa regra o padrão sempre venceria o closer. Efeito colateral aceito: se o SDR escolher à mão exatamente o usuário padrão enquanto o closer tem usuário no Kommo, o closer vence (é a regra de negócio: card é do closer).
- **Cache em memória do processo**: 5 min por org. O Coolify roda uma instância; com mais instâncias cada uma tem o seu, sem problema.

## Tasks

- [x] `crm-responsible.ts`: resolvedor + cache
- [x] `pushLeadToCrm` (Kommo) usa o resolvedor antes do `pushDeal`
- [x] Modal: travar confirmação enquanto carrega, avisar se falhar, `.catch/.finally`
- [x] Testes (`crm-responsible.test.ts`, `crm-push-responsible.test.ts`)
- [x] typecheck / lint / vitest nos arquivos tocados
- [ ] Commit / PR (decisão do usuário)
- [ ] Conferir em prod o próximo card criado por feedback "Realizada" (responsável = closer)

## File List

- `src/features/leads/services/crm-responsible.ts` (novo) · `crm-responsible.test.ts` (novo)
- `src/features/leads/services/crm-push-responsible.test.ts` (novo)
- `src/features/leads/services/crm-push.service.ts` (modificado — import + branch Kommo)
- `src/features/leads/components/LeadDetailLayout.tsx` (modificado — modal de Ganho)
- `docs/stories/kommo-responsible-fallback.story.md` (novo)

## Como testar

1. `pnpm exec vitest run src/features/leads/services/crm-responsible.test.ts src/features/leads/services/crm-push-responsible.test.ts`
2. Em prod, depois do deploy: marcar um lead com closer como Ganho **antes** da lista do Kommo carregar não é mais possível (botão travado). Para o fallback, conferir no log do Coolify `[crm-push] closer sem usuário no Kommo` / `card do Kommo sem responsável` quando aparecer, e o `responsible_user_id` do card criado após o feedback "Realizada".
