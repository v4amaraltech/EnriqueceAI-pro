# Microserviço de Voz WhatsApp (Epic 7 / story 7.1) — scaffold de referência

> **Este diretório é um SEED para um repositório SEPARADO** (não faz parte do build
> do Enriquece AI). Move estes arquivos para o repo do microserviço 7.1.

## O que é

Microserviço em **Go** que faz chamadas de voz 1:1 via WhatsApp (WebRTC ↔ MLow ↔
SRTP do WhatsApp). O Enriquece (Next.js) fala com ele **só por REST** — a API key
nunca chega ao browser (ver `src/features/whatsapp-calls/services/voice-service-client.ts`).

- **Base:** fork do **WaCalls** (`JotaDev66/WaCalls`, **MIT**, pure-Go: whatsmeow +
  pion + MLow vendorizado — **sem cgo**).
- **Reimplementar** (referência de arquitetura do AstraCalls AGPL — **NÃO copiar
  código**): auth por API key, webhook por sessão, fix de NAT 1:1 / ICE-TCP.
- **MVP:** 1 número por SDR, SQLite (sem Postgres por sessão).

## Arquitetura de rede (importante)

```
Pareamento (QR) e controle de chamada (sinalização SDP):
  browser ──> Enriquece (Server Action, injeta X-API-Key) ──> serviço /api/...
Mídia (áudio RTP/SRTP, ICE):
  browser <───────────── direto (UDP / ICE-TCP) ─────────────> serviço (IP público)
```

- O **HTTP/API** do serviço é chamado **server-to-server** pelo Enriquece (não
  precisa ser acessível pelo browser) — pode ficar atrás de TLS (Traefik).
- A **mídia** (porta UDP + fallback ICE-TCP) precisa ser **acessível pelo browser**
  → liberar no firewall e setar `WACALLS_PUBLIC_IP` (NAT 1:1).
- O **SSE `/api/events`** usa `?apiKey=` (EventSource não manda header) — proxiar
  pelo Enriquece (`/api/whatsapp-calls/events`) para não expor a key.

## Build & deploy (resumo)

```bash
# 1. build da imagem (pure-Go, estática)
docker build -t whatsapp-voice:latest .

# 2. configurar env (ver .env.example)
cp .env.example .env && vim .env

# 3. subir (network host — WebRTC precisa da interface real)
docker compose up -d

# 4. health
curl -H "X-API-Key: $WACALLS_API_KEY" http://localhost:8080/api/sessions
```

## Integração com o Enriquece (Coolify)

Depois que o serviço estiver no ar, configurar no Coolify (Runtime):

| Env (Enriquece) | Valor |
|-----------------|-------|
| `WACALLS_BASE_URL` | URL pública HTTPS do serviço (ex.: `https://voice.v4companyamaral.com`) |
| `WACALLS_API_KEY`  | **o mesmo** valor de `WACALLS_API_KEY` do serviço |

E **completar a perna de mídia** no Enriquece: `src/features/whatsapp-calls/voice-call-media.ts`
(RTCPeerConnection + troca de SDP via `/webrtc` + assinatura do SSE → state machine).

## Arquivos do scaffold
- `Dockerfile` — build multi-stage pure-Go.
- `docker-compose.yml` — deploy network=host + env + healthcheck.
- `.env.example` — variáveis do serviço.
- `ENDPOINTS.md` — **contrato REST/SSE** que o Enriquece consome (fonte da verdade).
