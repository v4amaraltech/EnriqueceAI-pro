# Story: Cópia de gravação espera antes de repetir quem não tem áudio

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-11-28 | @dev (Forge) | Implementado a pedido do Vini (sem validação do @po). |

## Origem

O cron `persist-pending-recordings` pega as 25 ligações mais novas e as 25 mais antigas sem cópia (60 dias). Quando não há áudio, nada era anotado e as mesmas voltavam a cada 15 min (752 pendentes em 28/11; 5 testadas, todas sem áudio, 15 a 34 s cada).

## Acceptance Criteria

- [x] Tentativa que não salva e não vira `mismatch` (inclusive exceção) anota em `calls.metadata`: `recording_persist_attempts` e `recording_persist_retry_at`.
- [x] Espera: 1ª falha 1 h, 2ª 6 h, 3ª 24 h, 4ª em diante 7 dias.
- [x] Quem espera fica fora da seleção (novas e antigas) e as próximas entram.
- [x] Metadata nulo ou sem a chave continua elegível; o filtro de `mismatch` continua valendo.
- [x] Nada é marcado como perdido; `persistCallRecording` não muda.

## Scope

**IN:** `src/app/api/cron/persist-pending-recordings/`.

**OUT:** worker, webhook, proxy, recover-missing-recordings, reparo, tamanho do lote, teto de tempo.

## File List

- `src/app/api/cron/persist-pending-recordings/route.ts`
- `src/app/api/cron/persist-pending-recordings/route.test.ts` (novo)
- `docs/stories/gravacao-sem-audio-espera.story.md` (novo)
