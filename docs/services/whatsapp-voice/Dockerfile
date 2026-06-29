# Microserviço de voz WhatsApp (Epic 7 / 7.1) — build pure-Go (sem cgo).
# Mover para o repo do fork WaCalls. Assume go.mod na raiz e binário em ./cmd/server
# (ajustar o path conforme a estrutura do fork).

# ---- build ----
FROM golang:1.26-bookworm AS build
WORKDIR /src

# cache de deps
COPY go.mod go.sum ./
RUN go mod download

# fonte
COPY . .

# Binário estático — MLow é vendorizado em Go puro, então CGO_ENABLED=0.
ENV CGO_ENABLED=0 GOOS=linux
RUN go build -trimpath -ldflags="-s -w" -o /out/voice ./cmd/server

# ---- runtime ----
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app

# Estado da sessão WhatsApp (SQLite) — montar volume em /data no compose.
ENV WACALLS_DB_PATH=/data/wacalls.db
VOLUME ["/data"]

COPY --from=build /out/voice /app/voice

# API HTTP (server-to-server). A mídia usa WACALLS_UDP_PORT (UDP + ICE-TCP),
# liberada no host — com network_mode: host o EXPOSE é só informativo.
EXPOSE 8080

USER nonroot:nonroot
ENTRYPOINT ["/app/voice"]
