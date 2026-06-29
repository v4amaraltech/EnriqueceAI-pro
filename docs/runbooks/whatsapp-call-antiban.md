# Runbook — Anti-ban da Ligação via WhatsApp

> Epic 7 / story 7.9. Operação dos números WhatsApp do discador nativo para
> minimizar risco de bloqueio (ban) pela Meta. Não há SLA público de tolerância —
> o MVP é **instrumentado para descobrir o limite seguro empiricamente**.

## Princípios

1. **1 número dedicado por SDR** (não usar número pessoal). Distribui risco e
   mantém a identidade de quem liga. Pareamento em *Integrações → Ligação via WhatsApp*.
2. **Posicionamento de reativação/aquecimento**, não cold-spam em escala. Ligar
   para base que já nos conhece reduz denúncia → reduz risco de ban.
3. **Respeitar o teto diário** por número (janela móvel de 24h).

## Guardrails implementados

| Guardrail | Onde | Valor de partida |
|-----------|------|------------------|
| Teto de ligações por número / 24h | `startWhatsAppCall` bloqueia ao atingir | `DAILY_CALL_LIMIT = 50` |
| Saúde por número (taxa de `not_connected`) | tela *Números WhatsApp* (badge) | degradado se ≥ `50%` em ≥ `5` chamadas |

Constantes em `src/features/whatsapp-calls/constants.ts` — **calibrar conforme a
operação** (subir/baixar o teto, ajustar o limiar) com base no que a tela mostra.

## Monitoramento (o que observar)

- **Uso (24h)** na tela de Números WhatsApp: `X/limite` por SDR.
- **Badge de saúde**:
  - `Saudável` — operando normal.
  - `Degradado` — taxa de `not_connected` alta (proxy de throttle/ban). **Ação:**
    pausar o número, investigar (sessão caiu? número sinalizado?), reduzir volume.
  - `Limite 24h` — teto atingido; novas ligações bloqueadas até a janela abrir.

## Resposta a incidente (suspeita de ban)

1. Número parou de conectar (pico de `not_connected`) ou sessão caiu repetidamente.
2. **Pausar** o número (não tentar reconectar em loop — pode piorar).
3. Verificar no WhatsApp do número se há aviso/bloqueio.
4. Se banido: trocar o número do SDR (re-parear um novo) e **baixar o teto** para
   o time enquanto se investiga o padrão que disparou o ban.

## Follow-ups (fora do MVP)

- Alerta ativo (notificação) na degradação — hoje é visual (badge) + log.
- Limite/limiar configurável por org/número (hoje é constante global).
- Auto-rotação de número / pool (hoje é 1 número fixo por SDR).
