# Story: Transcrição do motor novo aparece na ligação + toda ligação atendida é transcrita

## Status
InProgress

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-11-24 | @dev (Dex) | Runbook rodado em prod com OK do Vini: 768 ligações preenchidas (backup em `_bkp_calls_transcription_mirror_20261123`). Novembro 90 s+: 328/422 com texto em `calls.transcription` (era 55). |
| 2026-11-23 | @dev (Dex) | Implementado a pedido do Vini (sem passar pela validação do @po). Consulta da recuperação conferida em prod via PostgREST (GET): 729 ligações, igual à contagem em SQL. Simulação do runbook: 768 ligações, 273 de 90 s+ em novembro → cobertura vai a 328/422. typecheck, lint e test:run (5810) verdes. |
| 2026-11-23 | Vini + Claude | Story criada a partir da investigação de cobertura de transcrição (nov/2026). Decisões do Vini: copiar o texto para `calls`; recuperar 30 dias. |

## Origem

Em novembro (até 23/11), 422 ligações de 90 s ou mais. Medindo por `calls.transcription`, só 55 (13%) tinham texto. Medido em prod:

| Causa | Ligações | Evidência |
|---|---|---|
| Motor novo (AssemblyAI) transcreveu, mas grava só em `call_transcripts_v2`; tela, linha do tempo, e-mail do closer e a métrica leem `calls.transcription` | 309 | 309 linhas `completed` em `call_transcripts_v2`; `orchestrator.ts` "calls é só leitura" |
| Whisper só transcreve 5 min+ (`TRANSCRIPTION_MIN_DURATION_SECONDS = 300`) | 364 marcadas `skipped` (305 `duration_too_short`, 59 `duration_zero`) | `call.schemas.ts:8`, `api4com/route.ts:476` |
| Ligações antes de 11/11 (motor ligado em 11/11) — o cron do motor só reprocessa quem já tem linha na tabela nova | 88 sem nada | `findDrainCandidates` só lê `call_transcripts_v2`/`call_qualifications` |
| Ligação criada pela conferência da API4COM sem `answered_at` (motor exige) | 1 | `processEngineCall`: `if (!call.answered_at) return 'not_eligible'` |
| Outra org (flag só da V4) | 2 | `app_flags.call_transcription_engine_v1.allow_org_ids` |
| Texto vazio (~100 s de áudio) — hipótese: silêncio/caixa postal | 3 | `call_transcripts_v2.text` vazio |
| Whisper sem crédito no OpenRouter (402) | 3 (1 coberta pelo motor) | `calls.transcription_error` |

Cobertura real somando as duas tabelas: 328/422 (78%). Desde 11/11, quase 100%.

## Story

**As a** gestor / SDR,
**I want** ver a transcrição de toda ligação atendida na tela da ligação, na linha do tempo e no e-mail do closer,
**so that** nenhuma conversa fique sem registro.

## Acceptance Criteria

1. **Espelho em `calls`:** quando o motor tem transcrição `completed` com texto não vazio, grava o texto em `calls.transcription` **se ela estiver vazia** (nunca sobrescreve texto do Whisper).
   - Se o Whisper ainda vai rodar essa ligação (status `pending`/`null`/`processing` e duração ≥ piso do Whisper para ela — 300 s, ou 10 s com `ai_outcome` pendente), grava só o texto e mantém o status, para o BANT de 5 min+ continuar.
   - Senão, grava também `transcription_status = 'completed'` e limpa `transcription_error`.
   - Vale tanto na transcrição nova quanto quando o motor roda de novo uma ligação já transcrita.
   - Falha no espelho nunca muda o resultado do motor.
2. **Recuperação:** o cron `process-pending-transcription-engine` também pega ligações das orgs com a flag ligada, dos últimos **30 dias**, com 30 s ou mais, atendidas (`answered_at` ou `connected = true`), com mais de 30 min, **sem nenhuma linha** em `call_transcripts_v2`. Mais recentes primeiro. Retentativas e `processing` parado continuam com prioridade.
3. **Elegibilidade:** o motor aceita ligação com `answered_at` **ou** `connected = true`.
4. **Passivo:** runbook SQL (rodar só com OK do Vini) copia para `calls` o texto das transcrições do motor já `completed`, com a mesma regra do item 1.

## Scope

**IN:** `transcription-engine/orchestrator.ts`, `transcription-engine/constants.ts`, testes do motor, runbook `docs/runbooks/2026-11-23-espelhar-transcricoes-motor.sql`.

**OUT:**
- Ligar a flag para outras orgs (ex.: org do Lucas) — decisão de negócio, é um UPDATE em `app_flags`.
- Crédito do OpenRouter / desligar o Whisper (o BANT de 5 min+ depende dele).
- As 3 transcrições vazias (precisa ouvir o áudio).
- Trigger `auto_skip_ineligible_call_transcription` (`duration_zero` na criação): fica coberto pelo motor.

**Riscos:**
- Ligação de 5 min+ fica com o texto do motor até o Whisper terminar, e aí o texto do Whisper substitui (dois textos diferentes da mesma ligação, em momentos diferentes).
- Recuperação usa as vagas que sobram do lote de 5 a cada 15 min: ~729 ligações levam ~1,5 dia para zerar.
- Gravação antiga pode ter expirado na API4COM; as salvas no nosso Storage funcionam. Sem áudio, a linha vira `failed` e para após 3 tentativas.

**Custo:** ~US$ 0,23/h de áudio (estimativa do código, `ASSEMBLYAI_USD_PER_AUDIO_HOUR` — confirmar na fatura). Recuperação de 30 dias: ~21 h ≈ US$ 5, uma vez. Dia a dia: ~100 ligações de 90 s+/semana ≈ 5,5 h ≈ US$ 1,30/semana.

## Tasks

- [x] Espelho em `calls` (regra pura + gravação) + testes
- [x] Recuperação no `findDrainCandidates` + testes
- [x] Elegibilidade `answered_at` ou `connected` + teste
- [x] Runbook do passivo
- [x] typecheck / lint / test:run
- [x] Rodar o runbook em prod (com OK)
- [ ] Conferir em prod: cobertura de 90 s+ em `calls.transcription` depois do deploy

## File List

- `docs/stories/transcription-engine-visible-backlog.story.md` (novo)
- `docs/runbooks/2026-11-23-espelhar-transcricoes-motor.sql` (novo)
- `src/features/calls/services/transcription-engine/orchestrator.ts` (modificado: `buildCallTranscriptMirror`, `mirrorToCall`, `findBacklogCallIds`, elegibilidade por `connected`)
- `src/features/calls/services/transcription-engine/constants.ts` (modificado: `ENGINE_BACKLOG_LOOKBACK_DAYS`, `ENGINE_BACKLOG_MIN_AGE_MS`)
- `src/features/calls/services/transcription-engine/engine.test.ts` (modificado: 16 testes novos)
