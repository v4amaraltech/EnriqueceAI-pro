# Auditoria de Refatoração — EnriqueceAI

**Data:** 30/jun/2026 · **Escopo:** `src/` inteiro (~893 arquivos, ~107K LOC) · **Método:** 6 frentes de auditoria paralelas (leads; cadences+activities; integrations+calls+whatsapp-calls; statistics+dashboard+reports; auth+billing+settings+admin+notifications; app+lib+shared+features pequenas) · **Dimensões:** duplicação & código morto, aderência às convenções, type safety, testes/perf/segurança.

> **Veredito geral:** a base está **funcionalmente madura e bem comentada**, com aderência **alta** aos padrões do projeto (ActionResult, guards de auth, feature module, criptografia centralizada, webhooks assinados timing-safe). Não há defeito **crítico** aberto. A dívida real é **estrutural e sistêmica** — repetição de *andaime* (não de regra de negócio), erosão de type-safety por casts cegos, e algumas brechas de **autorização** de baixo blast-radius. Tudo endereçável incrementalmente.

---

## 1. Temas sistêmicos (aparecem em TODAS as frentes)

### A. Type-safety corroída por casts cegos — **maior dívida estrutural**
Raiz: o wrapper `src/lib/supabase/from.ts:16` faz `from(table as any)` e devolve builder genérico; cada caller "conserta" com cast.
- `as Record<string, unknown>` em **todo** `.insert()/.update()` (57× só em leads; dezenas em cadences/auth) → **anula a checagem de coluna/enum nas escritas** (já causou bugs de enum/coluna no histórico).
- `supabase.rpc as any` / `as never` / `as unknown as (fn,args)=>…` em **8+ arquivos** (execute-cadence, execute-activity, fetch-pending-activities, fetch-leads, recalc-*, ranking-metrics, sdr-overdue-summary, expire-inactive-leads).
- `as { data: T }` / `as unknown as Promise<…>` em torno de queries (reports, shared/fetch-drilldown com 8× `as any[]`).
- **Correção real = projeto dedicado** (helper `from`/`callRpc` tipado por `Database`). Esforço G. NÃO é autofix de baixo risco — remover sem tipar gera enxurrada de erros.

### B. Duplicação de andaime (não de negócio)
| Padrão duplicado | Onde | Esforço |
|---|---|---|
| Helper HTTP de CRM (`xxxFetch`: timeout/throw/json) | hubspot/pipedrive/rdstation/kommo adapters (4×) | M |
| OAuth `exchangeCode`/`refreshToken` | 4 adapters CRM | M |
| `pairing.ts` × `pairing-self.ts` (~95% iguais, inclui `mapVoiceError` verbatim) | whatsapp-calls (PR #130) | M |
| Motor de envio (insert de interação + update pós-envio + cast RPC) | execute-cadence.ts × execute-activity.ts | M |
| Métricas perda/conversão-origem/tempo-resposta (reimplementadas 3×) | statistics × dashboard × reports | G |
| Helpers de data + offset BRT `3*60*60*1000` (~20 ocorrências) | ~10 arquivos analíticos | M |
| Boilerplate bulk (valida tamanho + `endActiveEnrollments` + `revalidatePath`) | 8 bulk actions de leads | P–M |
| Bloco "buscar SDRs" (`organization_members` role=sdr) | ranking-metrics (7×) | M |
| `getManagerOrgId` em `try/catch {}` (engole `redirect()`) | 10 statistics + 6 settings actions | M |
| `UUID_REGEX` | 6 arquivos (routes + 1 UI) | P |
| Mapeamento de lead (`endereco.municipio/uf`, `primeiro_nome`) | fetch-pending-activities (2×) + 3 arquivos | M |

### C. Componentes-deus / funções gigantes
`LeadInfoPanel.tsx` (1257), `LeadDetailLayout.tsx` (891), `IntegrationsView.tsx` (778), `execute-cadence.ts` (794), `ranking-metrics.service.ts` (753), `check-email-replies.ts` (578), `kommo.adapter.ts` (756), `fetch-pending-activities.ts`. Misturam transformação de dados + estado + orquestração; pedem extração de helpers/hooks/subcomponentes.

### D. Lacunas de teste em código crítico/sensível
Sem teste: `crm-push`/`crm-resync`/`apollo` services, `crm-token` (cripto OAuth), `execute-cadence`, `check-email-replies`, `kommo.adapter`, `api4com.service`, `transcription.service`, e webhooks `api4com`/`apollo`/`inbound-leads`.

### E. Performance — sequential awaits, N+1, agregação em memória
- `await` sequencial independente (deveria ser `Promise.all`): statistics `activity-analytics` (5 queries), `conversion-analytics` (loop de 3), crm-sync push serial.
- N+1: leads `recalc-fit-scores`/`recalc-engagement-scores` (UPDATE/RPC por lead), 3× `getUserById` por membro (invite-member e create-org varrem **todas as orgs**), execute-cadence (lookup de vendor por enrollment).
- Pull de até 10k linhas cruas agregadas em JS (statistics) — deveria ser `GROUP BY` no banco.

---

## 2. Achados de segurança / autorização (prioridade)

| # | Sev | arquivo:linha | Vetor | Correção | Autofix |
|---|---|---|---|---|---|
| S1 | **HIGH** | `billing/actions/create-portal.ts:12` | Portal Stripe (cancelar assinatura / trocar cartão) gated só por `requireAuth` → **um SDR cancela a cobrança da org** | `getManagerOrgId()`/`requireManager()` | sim (P) |
| S2 | **HIGH** | `billing/actions/create-checkout.ts:17` | Criar/alterar assinatura gated só por `requireAuth` → SDR muda plano | `requireManager()` | sim (P) |
| S3 | **HIGH** | `auth/actions/update-member-role.ts:48` | UPDATE `.eq('id')` sem `org_id` → IDOR cross-org de role depende 100% da RLS | `.eq('org_id', callerOrg)` | sim (P) |
| S4 | **HIGH** | `auth/actions/update-member-status.ts:54` | Idem (troca de status cross-org) | `.eq('org_id', callerOrg)` | sim (P) |
| S5 | **HIGH** | `workers/backfill-kommo-orphans/route.ts:22` + `workers/resync-kommo-deal/route.ts:20` | Bearer comparado com `!==` (**não timing-safe**) sobre a `SERVICE_ROLE_KEY` → side-channel de tempo; ignora `verifyServiceRole()` | `verifyServiceRole(request)` | sim (P) |
| S6 | MED | `leads/actions/bulk-archive|delete|mark-lost.ts` | Update de `cadence_enrollments` por `lead_id` sem re-filtrar `org_id` → IDOR de baixa probabilidade nas bulk | Pré-validar leadIds por org / escopar update | não (M) |
| S7 | MED | `auth/actions/invite-member.ts:64` + `admin/create-org-with-manager.ts:41` | `getUserById` varre membros de **todas as orgs** (admin client) → enumeração cross-org + N+1 | `listUsers`/lookup por e-mail | não (M) |
| S8 | MED | `rdstation.adapter.ts:55` | Token OAuth concatenado na URL (`?token=`) → vaza em logs de proxy/erro | mover p/ header | não (M) |
| S9 | MED | `integrations/services/api4com.service.ts:108` | `console.warn(JSON.stringify(data))` loga resposta completa da chamada sempre | remover/gate debug | sim (P) |
| S10 | MED | `lib/auth/require-admin.ts:5` | Allowlist de admin **hardcoded** no código (UUIDs + PII em comentário); mudar admin exige deploy | mover p/ tabela/env | não (M) |
| S11 | MED | `auth/invite-member.ts:48` | `checkMemberLimit` + insert não-atômicos → convites concorrentes furam o limite do plano | constraint/transação | não (M) |
| S12 | INFO | `app/api/feedback/route.ts:47` | POST público por token-UUID **sem rate-limit** (demais públicos usam `checkRateLimit`) | `checkRateLimit` | não (P) |

> **Não-achados confirmados (falsos positivos evitados):** webhook Stripe valida assinatura; crons/admin usam `verifyCronSecret`/`verifyServiceRole` timing-safe; open-redirect `track/click` e SSRF `proxy/recording` fechados com allowlist; statistics=`requireManager` vs dashboard/reports=`requireAuth` é **intencional** e bate com o guard de rota; `CallResultModal` é compartilhado (sem duplicação de discador).

---

## 3. Plano de refatoração em ondas

### Onda 1 — Críticos autofix-seguros (segurança + correção · risco mínimo · 1 PR)
Tudo P, mecânico, sem mudar comportamento legítimo:
1. **S1+S2** — `requireManager()` em `create-portal.ts` e `create-checkout.ts`.
2. **S3+S4** — `.eq('org_id', callerOrg)` em `update-member-role.ts` e `update-member-status.ts`.
3. **S5** — `verifyServiceRole()` nos 2 workers Kommo.
4. **S9** — remover/gate o log de `originate-response` (api4com).
5. **email case** — `.toLowerCase()` no match de e-mail em `invite-member.ts:71` (corrige duplicação de convite).
6. **email.service.ts:299** — `(dbClient as any).from` → `from()` tipado.
7. **timeouts** — `AbortSignal.timeout(15s)` em `rdstation.adapter.ts:57` e `voice-service-client.ts:55` (cron travado por endpoint externo lento).

### Onda 2 — Perf de baixo risco (autofix-seguro)
- `Promise.all` nos `await` sequenciais independentes: `activity-analytics.service.ts:52-120` (5 queries) e `conversion-analytics.service.ts:84-96` (loop de 3).
- Remover código morto + sincronizar funções em `ranking-metrics.service.ts` (`:343`, `:576`, `fetchHitRateRanking`).
- Extrair `isUuid()` (6 cópias) e `BRT_OFFSET_MS`.

### Onda 3 — Duplicação estrutural (helpers compartilhados)
- `crm-http.ts` (unifica 4× `xxxFetch`, já corrige o timeout do RD).
- `pairing-core.ts` (unifica `pairing.ts` + `pairing-self.ts`).
- Módulo de envio compartilhado (`buildInteractionInsert` + `recordEmailSent`) entre execute-cadence/execute-activity.
- `shared/metrics/` (perda/conversão-origem/tempo-resposta) + `lib/utils/date-ranges` + `shared/components/charts/`.
- Helpers de bulk leads (`validateBulkLeadIds`, `endActiveEnrollments` — onde também se fecha o IDOR **S6**, `revalidateLeadPaths`).
- `findAuthUserByEmail` (mata os 3 N+1 + enumeração cross-org **S7**).

### Onda 4 — Projetos dedicados (esforço G, PR próprio cada)
- **Helper `from`/`callRpc` tipado** (elimina `as Record<string,unknown>` + `rpc as any` em todo o projeto). **Maior valor estrutural.**
- Cobertura de teste dos services críticos (CRM push/resync, crm-token, execute-cadence, check-email-replies, webhooks).
- Quebrar god-components (LeadInfoPanel, LeadDetailLayout, IntegrationsView) e funções gigantes.
- Schema Zod de env (`env.ts`) virar real: registrar segredos faltantes + migrar leituras `process.env` → `getEnv()`.
- Agregação de métricas no banco (RPC GROUP BY) em vez de pull de 10k linhas.

---

## 4. Índice das frentes (detalhe completo por área)
Cada frente produziu uma tabela própria (~15–25 achados com `arquivo:linha`). Os achados de maior severidade/valor foram promovidos para as seções 2 e 3 acima. Detalhe integral por área: leads, cadences+activities, integrations+calls+whatsapp, statistics+dashboard+reports, auth+billing+settings+admin+notifications, app+lib+shared.
