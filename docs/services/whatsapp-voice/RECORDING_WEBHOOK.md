# Webhook de Gravação — AstraCalls → EnriqueceAI

Contrato para o microserviço de voz (**AstraCalls**, repo `AstraOnlineWeb/AstraCalls`)
notificar o EnriqueceAI quando a gravação de uma **Ligação via WhatsApp** fica pronta.
Com isso, o app popula `calls.recording_url` e o pipeline existente baixa a
gravação, transcreve e roda o SPICED — **sem mais nenhuma mudança no app**.

> Lado do app já implementado (PR #126): endpoint `src/app/api/webhooks/wacalls/route.ts`
> + tabela buffer `whatsapp_pending_recordings` + consumo no `persistWhatsAppCall`.

---

## Visão geral do fluxo

```
Ligação WhatsApp encerra
        │
        ▼
AstraCalls finaliza a gravação  ──POST webhook──►  EnriqueceAI /api/webhooks/wacalls
        │                                                  │
        │                                                  ├─ call já existe? → grava calls.recording_url
        │                                                  └─ ainda não?      → buffer (whatsapp_pending_recordings)
        ▼                                                                         (persistWhatsAppCall consome depois)
                                                  cron persist-pending-recordings → baixa pro bucket
                                                  cron process-pending-transcriptions → transcreve → SPICED
```

**Importante (timing):** a gravação costuma ficar pronta **antes** de o SDR concluir
o modal de resultado (que é quando a `call` é gravada no banco). O webhook **não
precisa esperar** — chame assim que a gravação estiver disponível. O app bufferiza
por `service_call_id` e associa quando a call for criada.

---

## Endpoint

```
POST https://app.enriqueceai.com.br/api/webhooks/wacalls
```

### Headers
| Header | Valor |
|--------|-------|
| `Content-Type` | `application/json` |
| `X-Webhook-Secret` | valor de `WACALLS_WEBHOOK_SECRET` (o **mesmo** configurado no app) |

### Body (JSON)
```json
{
  "service_call_id": "1217385eafda46bf501b018bb1b26e9c",
  "recording_url": "https://voice.v4companyamaral.com/recordings/abc.mp3"
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|:-----------:|-----------|
| `service_call_id` | string | sim | O **`callId` retornado pelo AstraCalls** ao iniciar a chamada (`POST /api/sessions/{sid}/calls` → `{ call: { callId } }`). O app guarda esse valor em `calls.metadata.service_call_id`, e é a chave de associação. |
| `recording_url` | string (URL http/https) | sim | URL da gravação. Pode ser efêmera — o app baixa para o próprio bucket logo em seguida; ainda assim, **prefira uma URL durável** (≥ algumas horas) para tolerar atrasos do cron. |

> Aceitamos também os aliases `callId` (= `service_call_id`) e `recordingUrl`
> (= `recording_url`), mas use os nomes canônicos acima.

---

## Respostas

| Status | Significado | Ação do AstraCalls |
|--------|-------------|--------------------|
| `200 {"ok":true,"linked":true}` | Gravação associada à call existente | Sucesso — não reenviar |
| `200 {"ok":true,"buffered":true}` | Gravação bufferizada (call ainda não existe) | Sucesso — não reenviar |
| `400` | Payload inválido / campos faltando | Corrigir o payload (não adianta reenviar igual) |
| `401` | `X-Webhook-Secret` ausente ou incorreto | Corrigir o secret |
| `503` | `WACALLS_WEBHOOK_SECRET` não configurado no app | Avisar o time do EnriqueceAI |

### Idempotência & retry
- O webhook é **idempotente por `service_call_id`** (reenviar a mesma gravação é
  seguro — o buffer faz upsert e a call só é atualizada se ainda não tiver gravação).
- Em **erro de rede ou 5xx**, faça **retry com backoff** (ex.: 3 tentativas: 5s, 30s, 2min).
- Em **400/401**, **não** faça retry (é erro de payload/credencial).

---

## Exemplo (curl)

```bash
curl -X POST "https://app.enriqueceai.com.br/api/webhooks/wacalls" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $WACALLS_WEBHOOK_SECRET" \
  -d '{
    "service_call_id": "1217385eafda46bf501b018bb1b26e9c",
    "recording_url": "https://voice.v4companyamaral.com/recordings/abc.mp3"
  }'
```

---

## Ativação (checklist)

- [ ] Gerar um segredo forte e setar **`WACALLS_WEBHOOK_SECRET`** (mesmo valor) em:
  - [ ] **EnriqueceAI** — env do app no **Coolify** (Runtime)
  - [ ] **AstraCalls** — config do microserviço
- [ ] Implementar no AstraCalls a chamada `POST .../api/webhooks/wacalls` ao finalizar
      a gravação, enviando `service_call_id` + `recording_url`.
- [ ] **Redeploy** do EnriqueceAI no Coolify (para o endpoint subir, se ainda não).
- [ ] Teste: fazer 1 ligação WhatsApp → verificar `calls.recording_url` populado e a
      transcrição/SPICED rodando.

---

## Referências
- App: `src/app/api/webhooks/wacalls/route.ts`
- Buffer: migration `supabase/migrations/20260629160000_whatsapp_pending_recordings.sql`
- Consumo: `src/features/whatsapp-calls/actions/persist-call.ts` (`persistWhatsAppCall`)
- Pipeline downstream: crons `persist-pending-recordings` + `process-pending-transcriptions`
