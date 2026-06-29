# Contrato REST/SSE — Microserviço de Voz WhatsApp (Epic 7 / 7.1)

> **Fonte da verdade da integração.** Estes endpoints são consumidos por
> `src/features/whatsapp-calls/services/voice-service-client.ts` (REST) e pela
> boundary `voice-call-media.ts` (WebRTC/SSE). Implementar **exatamente** estes
> shapes para encaixar sem mudar o app — ou, se divergir, ajustar SÓ esses 2
> arquivos no Enriquece.

## Auth (todas as rotas `/api/*`)

- Header **`X-API-Key: <WACALLS_API_KEY>`**.
- Exceção SSE: `GET /api/events?apiKey=<...>` (EventSource não manda header).
- Sem key válida → **401**.

Legenda: 🟢 = já consumido hoje pelo app · 🟡 = boundary 7.1 (a completar em `voice-call-media.ts`).

---

## Sessões (pareamento de número)

### 🟢 `POST /api/sessions`
Cria conta e inicia o pareamento (QR). `name` identifica o SDR (o app envia o `user_id`).
```jsonc
// req
{ "name": "c6213fe4-...-user-id" }
// res 200
{ "id": "sess_abc", "jid": null, "status": "pairing", "paired": false,
  "qr": "data:image/png;base64,..." }   // qr também aceito como "qrCode" | "code"
```
O app normaliza: `sid = id|sid`, `status` via regra abaixo, `phoneNumber = jid` (limpo), `qr`.

### 🟢 `GET /api/sessions`
Lista as contas. O app acha pelo `sid` e normaliza.
```jsonc
// res 200
[ { "id": "sess_abc", "jid": "5511999990000@s.whatsapp.net",
    "status": "connected", "paired": true } ]
```

### 🟢 `POST /api/sessions/{sid}/pair`
Gera um novo QR (re-pareamento de sessão morta). Mesmo shape do create.

### `DELETE /api/sessions/{sid}`
Logout + remove a conta. (Reservado; o app ainda não chama.)

**Mapeamento de status (o app faz):**
| Serviço | App (`status`) |
|---------|----------------|
| `paired: true` | `connected` |
| `status: "disconnected" \| "logged_out"` | `disconnected` |
| qualquer outro (em pareamento) | `pairing` |

`phoneNumber` = dígitos do `jid` antes do `@` (ex.: `5511999990000@...` → `5511999990000`).

---

## Chamadas

### 🟢 `POST /api/sessions/{sid}/calls`
Inicia a chamada de saída. `record` vem **sempre `true`** (gravação ON — story 7.8).
```jsonc
// req
{ "phone": "5511999990000", "record": true }
// res 200
{ "call_id": "call_xyz" }   // aceito como "call_id" | "id"
```

### 🟡 `POST /api/sessions/{sid}/calls/{id}/webrtc`
Troca de SDP (sinalização). O browser cria a offer; o serviço (pion) responde a answer.
```jsonc
// req  (offer do browser, proxiada pelo Enriquece)
{ "sdp": "v=0\r\no=- ... (offer)" }
// res 200
{ "sdp": "v=0\r\no=- ... (answer)" }
```
> A **mídia** (RTP/SRTP/ICE) flui **direto** browser ↔ serviço pela `WACALLS_UDP_PORT`
> (com NAT 1:1 + ICE-TCP). Só a **sinalização** passa pelo proxy do Enriquece.

### 🟢 `DELETE /api/sessions/{sid}/calls/{id}`
Encerra a chamada ativa.

---

## Eventos (lifecycle)

### 🟡 `GET /api/events?apiKey=<...>` (SSE)
Stream de eventos. Substitui o "Atendeu" manual do painel e preenche a gravação.
```
event: call
data: { "session": "sess_abc", "callId": "call_xyz", "state": "ringing" }

data: { "session": "sess_abc", "callId": "call_xyz", "state": "answered", "at": 1719... }

data: { "session": "sess_abc", "callId": "call_xyz", "state": "ended",
        "durationSeconds": 73, "recordingUrl": "https://voice.../rec/call_xyz.mp3" }
```
Estados esperados: `ringing` · `answered` · `ended` · `rejected` · `no-answer`.
O `ended` **deve** carregar `recordingUrl` (story 7.8 → `persistWhatsAppCall`).

### 🟡 (alternativa) `POST/GET/DELETE /api/sessions/{sid}/webhook`
Configura uma URL que recebe o mesmo lifecycle via POST (útil para o pipeline
server-side de BI sem manter SSE aberto). Opcional no MVP.

---

## Notas de gravação (7.8)

A `recordingUrl` precisa ser **baixável** pelo cron `persist-pending-recordings`
do Enriquece (faz `fetch(url)` simples). Se a URL exigir auth, o serviço deve:
- expor uma URL **pública/assinada** temporária, **ou**
- o Enriquece proxiar o download (ajuste em `recording-storage.service`).

## Checklist de paridade (o que o 7.1 precisa entregar p/ o app funcionar)
- [ ] `X-API-Key` em `/api/*` + `?apiKey=` no `/api/events`.
- [ ] Sessões: `POST`/`GET`/`POST .../pair` com os shapes acima (id, jid, status, paired, qr).
- [ ] Chamadas: `POST .../calls` ({phone,record}→{call_id}), `DELETE .../calls/{id}`.
- [ ] `POST .../calls/{id}/webrtc` (offer→answer) + NAT 1:1/ICE-TCP na `WACALLS_UDP_PORT`.
- [ ] SSE `/api/events` com `ringing/answered/ended(+recordingUrl)/rejected/no-answer`.
