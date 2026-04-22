# QA Fix Request — Code Review 2026-04-21

**Reviewer:** Quinn (@qa)
**Scope:** 10 commits recentes (642850d..3247fa5)
**Arquivos:** 11 modificados, 759 linhas adicionadas

---

## CRITICAL — Corrigir imediatamente

### C1: GET webhook expõe secretLength
**Arquivo:** `src/app/api/webhooks/api4com/route.ts:183-189`
**Risco:** Atacante descobre tamanho do secret sem autenticação
**Fix:** Remover `secretLength` e `tokenLength` da resposta do GET. Manter apenas `tokenValid` e `status`.

```diff
- return NextResponse.json({
-   status: 'ok',
-   tokenValid,
-   tokenLength: token.length,
-   secretLength: webhookSecret.length,
-   timestamp: new Date().toISOString(),
- });
+ return NextResponse.json({
+   status: 'ok',
+   tokenValid,
+   timestamp: new Date().toISOString(),
+ });
```

### C2: Resync worker sem validação de org
**Arquivo:** `src/app/api/workers/resync-kommo-deal/route.ts`
**Risco:** Service role key permite enumerar leads de qualquer org. Respostas diferentes para "lead not found" vs "no connection" facilitam enumeração.
**Fix:** Unificar mensagens de erro para retornar `404 Not found` genérico. Validar formato UUID do leadId.

```typescript
// Validar UUID
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!leadId || !UUID_RE.test(leadId)) {
  return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
}

// Unificar erros — não revelar se lead existe ou não
if (!lead || !connection) {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
```

### C3: Kommo responses expostas na resposta do resync
**Arquivo:** `src/app/api/workers/resync-kommo-deal/route.ts:206`
**Risco:** Vaza schema interno da API Kommo (field IDs, validation errors)
**Fix:** Não retornar `errText` do Kommo. Retornar apenas o field key e um status genérico.

```diff
- failed.push(`${fieldKey}: ${errText.slice(0, 100)}`);
+ failed.push(fieldKey);
```

---

## HIGH — Corrigir antes do próximo deploy

### H1: Sem rate limiting nos workers
**Arquivos:** `resync-kommo-deal/route.ts`, `api4com/route.ts`
**Risco:** Atacante pode disparar centenas de chamadas ao Kommo/transcription
**Fix:** Adicionar rate limiting básico. Sugestão: verificar contagem de requests recentes por IP ou usar middleware de rate limit (ex: `@upstash/ratelimit` ou header-based).

### H2: Loop ilimitado no resync — sem timeout
**Arquivo:** `src/app/api/workers/resync-kommo-deal/route.ts:195-212`
**Risco:** 20+ PATCHs sequenciais ao Kommo sem circuit breaker
**Fix:** Adicionar `maxDuration = 30` no route e limitar fields a no máximo 25.

### H3: contactExternalId pode ser undefined no pushDeal
**Arquivo:** `src/features/leads/actions/lead-crm.ts:633-634`
**Risco:** Deal criado sem vínculo ao contato
**Fix:** Guard clause antes de chamar pushDeal:

```typescript
const resolvedContactId = contactExternalId ?? existingSync?.external_id;
if (!resolvedContactId) {
  console.error('[lead-crm] No contact ID to link deal');
  // Deal não criado, mas lead já está qualified — não falhar
  return { success: true, data: { dealCreated: false } };
}
```

### H4: Missing index em interactions(lead_id, created_at)
**Arquivo:** Nova migration necessária
**Risco:** Full table scan na função `calculate_engagement_score()` para cada lead
**Fix:** Criar index composto:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interactions_lead_created
  ON interactions (lead_id, created_at DESC);
```

### H5: Parity TS/SQL no tratamento de interações antigas
**Arquivo:** `engagement-score.service.ts` vs SQL function
**Risco:** TS retorna `null` quando não há interações; SQL retorna `0` quando existem interações mas todas > 90 dias. Comportamentos divergentes.
**Fix:** Alinhar SQL com TS — quando existem interações antigas mas nenhuma recente, retornar 0 (ambos). Verificar que TS também trata este caso. Atualmente o TS só recebe interações como input (não sabe se existem antigas), então a divergência é aceitável se o recálculo sempre vem via SQL. **Documentar esta diferença.**

---

## MEDIUM — Backlog de debt técnico

| # | Issue | Arquivo | Sugestão |
|---|-------|---------|----------|
| M1 | `formatValueForKommo` aceita datas inválidas | `lead-crm.ts` | Validar com regex mais estrito ou usar `Date.parse` com check |
| M2 | `triggerTranscription` sem exponential backoff | `api4com/route.ts` | Mudar delay de `2000 * (attempt + 1)` para `2000 * 2^attempt` |
| M3 | Enum resolution sem cache | `kommo.adapter.ts` | Cache field defs por 5min (Map com TTL) |
| M4 | Webhook idempotency race | `api4com/route.ts` | O `isEventProcessed` + `markEventReceived` não é atômico — usar `INSERT ... ON CONFLICT` |
| M5 | Testes não cobrem replied+phone | `engagement-score.test.ts` | Adicionar testes para combinações channel+type faltantes |
| M6 | leadId sem validação UUID | `resync-kommo-deal` | Coberto pelo fix C2 |

---

## Prioridade de execução

1. **C1 + C2 + C3** → 15 min de trabalho, impacto de segurança imediato
2. **H3 + H4** → 10 min, previne bugs em produção
3. **H5** → 5 min, documentar divergência
4. **H1 + H2** → 30 min, rate limiting e circuit breaker
5. **M1-M5** → backlog

---

*Gerado por Quinn (@qa) — 2026-04-21*
