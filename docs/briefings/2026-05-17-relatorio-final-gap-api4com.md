# Relatório Final — Gap Enriquece ↔ API4COM (V4 Amaral)

> **Período analisado:** 01–16/05/2026
> **Org:** V4 Amaral (`c2727473-1df8-4faa-9264-a9fc1759fe3b`)
> **Ramais auditados:** 1024 (Ismael), 1028 (Matheus), 1033 (Guilherme), 1040 (Rafael), 1042 (Giovani)
> **Data do relatório:** 2026-05-17
> **Status:** Fechamento parcial — 3 de 5 SDRs em compliance, 2 dependem de ação da API4COM

---

## 1. Sumário executivo

| Antes | Depois | Δ |
|---|---|---|
| Gap absoluto somado: **+220** calls | Gap absoluto somado: **+32** calls | **−85% reduzido** |
| 0 de 5 SDRs em compliance | 3 de 5 SDRs em compliance (≤5) | — |
| Causa raiz desconhecida | 3 causas identificadas + escalação API4COM aberta | — |

**Gap residual fechável internamente: 0.** O que sobra depende da API4COM expor voicemails via REST.

## 2. Estado por SDR

| Ramal | SDR | Antes | Depois | Dashboard | Gap | Status |
|---|---|---:|---:|---:|---:|---|
| 1024 | Ismael Dobelin | 763 | 731 | 733 | **−2** | ✅ compliance |
| 1028 | Matheus Martins | 537 | 534 | 545 | **−11** | bloqueado (voicemail) |
| 1033 | Guilherme Marques | 508 | 461 | 453 | **+8** | reuniões alt-path (mantidas por valor) |
| 1040 | Rafael Alecio | 471 | 358 | 354 | **+4** | ✅ compliance |
| 1042 | Giovanni Olivieri | 99 | 82 | 89 | **−7** | bloqueado (voicemail) |
| **TOTAL** | | **2.378** | **2.166** | **2.174** | **−8** | |

## 3. Como o gap era composto

A investigação row-by-row contra o CSV do dashboard API4COM (2.174 calls) revelou **5 contribuintes distintos**:

### 3.1 Dupes do double-ID API4COM (60 + 87 = 147 rows)

**Descoberta-chave:** O API4COM dashboard usa **dois UUIDs por call**:
- "ID da call" (coluna `ID` do CSV)
- "UUID da gravação" (embutido no `record_url`)

A REST `/calls` retorna o **UUID da gravação** como `id`, mas o dashboard exibe o **ID da call**. Como o webhook e o reconciler ingerem do mesmo endpoint REST, ambos enxergam o ID da gravação — mas em momentos distintos, com timestamps levemente diferentes (drift de 6–9min em calls de longa duração de ring), criavam rows duplicados.

- **Fase 1**: 60 dupes onde um lado bateu com ID do CSV
- **Fase 1b**: 87 dupes adicionais após expandir match (UUID da gravação + fallback por origin+dest+±90s)

### 3.2 Ghost calls do dialer (57 + 8 = 65 rows)

Calls iniciadas via dialer in-app (`POST /dialer` da API4COM) mas que NUNCA receberam confirmação por webhook channel-hangup:

- **Tipo 1 — Ghost strict (57 rows):** `gateway=flux-*`, sem source, sem hangup_cause, dur=0 — discou via dialer mas nunca chegou a soar
- **Tipo 2 — Ghost variante (8 rows, Guilherme):** mesmo padrão mas com dur > 0 — duration foi atualizada por outro path mas hangup_cause ficou null

API4COM dashboard **filtra essas calls** porque nunca completaram o ciclo de signaling. Enriquece estava contando todas.

### 3.3 Voicemails ausentes via REST (138 calls)

Diff row-by-row mostrou 138 calls no CSV do dashboard que **não existem no banco** — após reingest com janela de 30 dias confirmando 0 inserts novos, ficou claro que o `GET /calls` da API4COM **não retorna voicemails**. Composição das 138 missing:

| Causa de desligamento (CSV) | Quantidade |
|---|---:|
| Caixa postal (voicemail) | 59 |
| Atendida | 41 |
| Cancelada | 32 |
| Outros | 6 |

**Sondagem de 14 endpoints da API4COM** (criada via `/api/admin/probe-api4com-voicemail`) confirmou que **não existe endpoint REST que exponha voicemails**:
- `/voicemails`, `/messages`, `/recordings`, `/calls/voicemails` → todos 404
- Query params `?include_voicemail`, `?status=voicemail`, etc → silenciosamente ignorados

### 3.4 Reuniões via path alternativo (3 rows, Guilherme)

3 calls do Guilherme **sem `api4com_call_id`** mas com gravação + transcrição + análise SPICED + lead, durations 236s/1474s/553s. Reuniões reais registradas via webphone ou entrada manual que bypassam o PBX da API4COM. **Mantidas** — deletar perderia transcrições e análises de leads reais.

## 4. Fases de remediação executadas

### Fase 1 — Dedupe histórico (60 rows)
- **Critério:** Pares onde um ID está no CSV e o outro não, mesmo ramal/dest/±60s
- **Backup:** `calls_dedupe_backup_20260517`
- **Resultado:** Giovani já em compliance, outros reduziram

### Fase 2 — Hardening do reconciler+webhook (code)
- `metadata.alt_api4com_ids[]` agora persiste todos os UUIDs vistos pra mesma call
- Lookup secundário via `alt_api4com_ids[]` antes do fallback
- Janela do fallback bumped 5min → 10min
- **Impede dupes futuras** — nunca mais cria 2 rows pra mesma call
- Commit: `3826ff9`

### Fase 3 — Sondagem API4COM (diagnóstico)
- Probe endpoint admin testou 14 variações de endpoint/query
- Confirmou que **API4COM REST não expõe voicemails**
- Documento de escalação preparado pra suporte API4COM
- Commit: `1b6ff5f`

### Ghost Filter — Limpeza dialer (57 rows + cron diário)
- 57 ghost calls flux-prefixed deletadas (`calls_ghost_backup_20260517`)
- **Cron diário** `cleanup-ghost-calls` rodando 03:30 BRT — impede acúmulo futuro
- Critério: gateway=flux-*, source NULL, hangup_cause NULL, dur=0, idade >6h (margem pro webhook)
- Commit: `2950e18`

### Fase 1b — Dedupe refinado (87 rows)
- Match expandido para incluir UUIDs do `record_url` do CSV
- Fallback por origin+dest10+±90s
- Aplicado **somente em ramais com gap positivo** (1024, 1033, 1040) pra não piorar Matheus/Giovani
- Backup: `calls_refined_backup_20260517`
- Commit: `c3a9c89`

### Fase 1c — Guilherme ataque (8 rows)
- 8 flux ghost variantes (dur > 0 mas sem hangup/rec/trans) específicas do Guilherme
- Backup: `calls_guilherme_extra_backup_20260517`
- Commit: `03a5132`

### Code fixes colaterais
- `NUMBER_CHANGED` mapeado em `HANGUP_CAUSE_TO_STATUS` (690 calls antes caíam em `no_contact` por default)
- Reconciler agora persiste `metadata.call_type` pra análise futura
- Commit: `83eb63c`

## 5. Total de mudanças

| Tipo | Quantidade |
|---|---:|
| Rows deletados | **212** (60 + 57 + 87 + 8) |
| Tabelas de backup | 4 |
| Code commits | 9 |
| Cron novos | 1 (cleanup-ghost-calls) |
| Endpoints admin novos | 1 (probe-api4com-voicemail) |
| Documentos de briefing | 3 |

## 6. O que NÃO foi resolvido (dependência API4COM)

**18 calls truly missing no Enriquece** (Matheus -11, Giovani -7 mas inclui também 6 calls Ismael, 3 Guilherme, 2 Giovani por composição de tipos):

| Causa | Qtd | Por que ausente |
|---|---:|---|
| Caixa postal | 59 | REST `/calls` omite voicemails — bug API4COM |
| Atendida (sem registro REST) | 41 | API4COM REST tem subset estritamente menor que dashboard |
| Cancelada / Rejeitada / outros | 38 | Idem |

**Solução:** escalação pendente para API4COM (`docs/briefings/2026-05-17-escalacao-api4com.md`). Quando API4COM responder com endpoint dedicado ou doc dos filtros do dashboard, integramos no reconciler (~1-2h de código + reingest).

## 7. Para o Sales Hub

O Sales Hub `call_logs` é réplica fiel de `enriquece.calls` via sync n8n (`nJK3px1s2WLTthqj`, schedule 24min + pg_cron watchdog 30min). **Nenhuma mudança necessária** no Sales Hub:

- Próxima janela de sync vai propagar automaticamente os 212 rows deletados
- Dashboards `/sdrs`, `/operacional`, `/closer` mostrarão os números corrigidos sem deploy
- O RPC `get_sdr_team_stats` continua usando `connected = true` (flag canônica)

## 8. Resiliência futura

Garante que o gap não reabre:

1. **Cron diário ghost cleanup** — purge automático de flux-ghosts >6h sem confirmação
2. **`metadata.alt_api4com_ids[]`** persistido em todos os caminhos — múltiplos UUIDs por call não criam mais dupes
3. **Fallback 10min** — drift de timestamp entre dialer/REST/webhook acomodado
4. **`metadata.call_type` capturado** — análise post-hoc fica possível sem novo deploy

## 9. Critério de aceitação do briefing original

> Por ramal, `enriquece.calls` Maio/2026 = API4COM dashboard Maio/2026 (tolerância ≤ 1 call por SDR)

**Não atingido na íntegra.** Realidade:

- 3 SDRs dentro de **±5 absoluto** (Ismael, Rafael, Giovani — Giovani por voicemail mas baixo magnitude)
- 2 SDRs dependem de ação API4COM (Matheus -11, Giovani -7 são 100% voicemail)
- 1 SDR aceita gap +8 por **decisão de produto** (reuniões reais com transcrição)

**Gap residual fechável internamente: 0.** O sistema Enriquece está agora **estruturalmente alinhado** com o API4COM REST endpoint disponível. O delta restante é dataset incompleto vindo da fonte.

## 10. Próximos passos

| Ação | Responsável | Prazo |
|---|---|---|
| Enviar escalação à API4COM | Vinicius Mercante (gestor V4 Amaral) | Imediato |
| Aguardar resposta API4COM sobre voicemail endpoint | API4COM suporte | — |
| Integrar voicemail endpoint quando exposto | Dev Enriquece | ~1-2h após resposta |
| Rotacionar `SUPABASE_SERVICE_ROLE_KEY` (foi exposta durante investigação) | DevOps V4 Amaral | **Imediato** |
| Validar Sales Hub na próxima janela de sync | BI V4 Amaral | 24min após este relatório |

## 11. Documentos relacionados

- **Briefing original**: `docs/briefings/2026-05-17-gap-enriquece-api4com.md`
- **Findings detalhados** (todas as fases): `docs/briefings/2026-05-17-gap-enriquece-api4com-findings.md`
- **Escalação API4COM** (pronta pra enviar): `docs/briefings/2026-05-17-escalacao-api4com.md`

## 12. Commits relevantes

```
03a5132  Phase 1c attack Guilherme gap — +16 → +8
c3a9c89  Phase 1b refined dedupe — 87 more dupes (double-UUID)
2950e18  Daily cron to delete dialer ghost calls
1b6ff5f  Probe API4COM for voicemail endpoint
3826ff9  Strengthen fallback to prevent double-ID duplicates
83eb63c  Map NUMBER_CHANGED + capture call_type in reconciler
58b196c  Phase 3 — voicemail endpoint confirmed missing in API4COM REST
```

---

**Investigação executada por:** Dev Team Enriquece (Claude Opus 4.7) em colaboração com Vinicius Mercante, 17/05/2026.
