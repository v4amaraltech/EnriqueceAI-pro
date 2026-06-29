# Epic 7: Ligação via WhatsApp (discador WhatsApp-nativo)

**Status:** Draft
**Created:** 2026-06-28
**Author:** @dev (Dex) — derivado do plano `docs/plans/whatsapp-call-activity-plan.md`
**Priority:** HIGH
**Total Stories:** 9 (3 Waves)

---

## Epic Goal

Dar ao SDR um **discador WhatsApp-nativo (click-to-call)** dentro da tela de execução da cadência: quando o lead chega num passo "Ligação via WhatsApp", o SDR clica em "Ligar via WhatsApp", a chamada sai pela infraestrutura do próprio WhatsApp (não por telefonia/PSTN), o SDR registra o resultado (disposition) e a cadência avança. **Objetivo de negócio:** contornar o bloqueio de operadora que inviabilizou o discador anterior (Retell + API4COM, ~73-76% de falha) e melhorar connect rate.

**MVP:** 1 SDR · 1 número dedicado · click-to-call humano · disposition manual · gravação ON (com consentimento) · evento no BI. Meta do MVP: **validar connect rate e taxa de atendimento** antes de generalizar.

## Existing System Context

- **Tech Stack:** Next.js 16 (App Router), React 19, Supabase (`dhkmonctyoaenejemkrt`), TypeScript strict, Tailwind v4 + shadcn/ui.
- **Reaproveita:** engine de cadência (canal ≠ email já é atividade manual na fila), tabela `calls` (já tem `connected/answered_at/duration_seconds/recording_url/transcription`), enum `call_status` (disposition), RPC `advance_enrollment_after_step`, `resolveWhatsAppPhone()`, pipeline BI n8n "Sync Calls".
- **Decisões travadas (plano):** reusa `channel='phone'` + `cadence_steps.call_provider='whatsapp'` (NÃO cria enum novo); `calls.type='outbound'` + `metadata.provider='whatsapp'`; 1 número por SDR; gravação ON com consentimento LGPD; callback reabre o mesmo step.

## Reference

- **Plano completo:** `docs/plans/whatsapp-call-activity-plan.md`
- **Repos de voz:** WaCalls (`JotaDev66/WaCalls`, MIT — base) · AstraCalls (`AstraOnlineWeb/AstraCalls`, AGPL — só referência de arquitetura, NÃO importar código).
- **BI:** memória `calls-bi-sync-path.md` (n8n `nJK3px1s2WLTthqj` → `get_calls_for_v4sales` → `sync_calls_from_enriquece`).

## Quality Gate Standard

- **Dev:** CodeRabbit self-healing max 2 iter, CRITICAL/HIGH auto-fix.
- **Gate:** `pnpm lint && pnpm typecheck && pnpm test:run && pnpm build` (CI `Lint · Typecheck · Test · Build`) antes de PR.
- **DB:** seguir `dev-checkpoints.md` (trigger `update_updated_at()`, RLS `public.user_org_id()`/`is_manager()`, timestamp único).

---

## Wave Structure

| Wave | Foco | Stories | Esforço |
|------|------|---------|---------|
| **Wave 1** | Fundação: voz + data + pareamento | 7.1 — 7.3 | L+S+M |
| **Wave 2** | Builder + execução + disposition | 7.4 — 7.6 | S+M+M |
| **Wave 3** | BI + gravação/LGPD + anti-ban | 7.7 — 7.9 | M+M+S |

> **Caminho crítico:** 7.1 (microserviço) é o maior risco e bloqueia 7.5. 7.2 (data) bloqueia quase tudo. Recomenda-se 7.1 e 7.2 em paralelo.

---

## Wave 1 — Fundação

### Story 7.1: Microserviço de voz WhatsApp (fork WaCalls MIT + deploy VPS)
**Executor:** @dev | **Esforço:** L (1.5-2 sem) | **Risco:** Alto
Fork MIT do WaCalls; reimplementar (referência AstraCalls, sem copiar): **API key auth**, **webhook por sessão**, **NAT 1:1/ICE-TCP** (`WACALLS_PUBLIC_IP=auto`, `WACALLS_UDP_PORT`). Deploy Docker network=host na VPS + HTTPS (Traefik). Entrega: serviço estável expondo `/api/sessions*`, `/calls`, `/webrtc`, `/events` (SSE), `/history`.

### Story 7.2: Data model — `call_provider` + `whatsapp_call_sessions`
**Executor:** @dev (delegar DDL a @data-engineer) | **Esforço:** S (1-2 dias) | **Risco:** Baixo
Migration: `ALTER TABLE cadence_steps ADD COLUMN call_provider text`; `CREATE TABLE whatsapp_call_sessions` (org_id, user_id, service_session_id, phone_number, status, paired_at, timestamps) + RLS + trigger.

### Story 7.3: Pareamento de número por SDR
**Executor:** @dev | **Esforço:** M (3-5 dias) | **Risco:** Médio
Fluxo (manager): criar sessão no microserviço (`POST /api/sessions`), exibir QR, pollar status via `GET /api/sessions`, persistir em `whatsapp_call_sessions`, re-parear sessão morta. Proxy server-side injeta a API key (browser nunca fala direto com o serviço).

---

## Wave 2 — Builder + Execução

### Story 7.4: Passo "Ligação via WhatsApp" no builder de cadência
**Executor:** @dev | **Esforço:** S (1-2 dias) | **Risco:** Baixo
Evolui o item já criado na sidebar: passo `channel='phone'` + `call_provider='whatsapp'`. Ajustar `ActivityTypeSidebar`/`StepEditorDialog`/schemas + persistir `call_provider`. Gate de elegibilidade (só executável se `resolveWhatsAppPhone(lead)` ≠ ∅ e `whatsapp_invalid_at IS NULL`).

### Story 7.5: Painel de execução click-to-call (WebRTC)
**Executor:** @dev | **Esforço:** M (3-5 dias) | **Risco:** Médio
`ActivityWhatsAppCallPanel` renderizado quando `step.channel==='phone' && call_provider==='whatsapp'`. Captura mic (getUserMedia), handshake WebRTC, estados `idle→ringing→active(timer)→ended`, cronômetro só na conexão real, assina SSE `/events`. Seletor de número via `getAllLeadPhones`.

### Story 7.6: Disposition → avanço/callback da cadência
**Executor:** @dev | **Esforço:** M (2-3 dias) | **Risco:** Médio
Captura disposition (enum `call_status`) ao desligar; mapa disposition→ação (§E do plano). Callback ("reagendou") = **reabre o mesmo step** com `next_step_due` escolhido pelo SDR → action nova "reagendar step atual" (sem `advance_enrollment_after_step`). Demais fecham a atividade e avançam.

---

## Wave 3 — Dados, BI, Gravação, Operação

### Story 7.7: Persistência de call + interaction + webhook BI
**Executor:** @dev | **Esforço:** S-M (2-3 dias) | **Risco:** Médio
Gravar `calls` (`type='outbound'`, `metadata.provider='whatsapp'`, status/connected/answered_at/duration) + `interactions` (`channel='phone'`, step_id, cadence_id). Disparar webhook `/calls` do n8n. Validar contagem no BI (zero mudança no warehouse — ver memória).

### Story 7.8: Gravação + consentimento LGPD (+ transcrição opcional)
**Executor:** @dev | **Esforço:** M (3-4 dias) | **Risco:** Médio
`record:true` no start; salvar `recording_url`/`recording_storage_path`. **Aviso de consentimento obrigatório** no início da chamada (base legal LGPD). Transcrição reusa `transcription_status` (opcional, pode ir pra backlog).

### Story 7.9: Anti-ban + observabilidade do número
**Executor:** @dev | **Esforço:** S (1-2 dias) | **Risco:** — (mitiga risco do epic)
Limite diário por número (reusar padrão `controle_disparo`). Monitor de saúde: taxa de `not_connected`/erro de sessão por número, com alerta de degradação (sinal precoce de throttle/ban).

---

## Riscos do Epic

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| Ban do número WhatsApp por volume VoIP | Média | Alto | 1 número/SDR, limite diário, posicionamento reativação (7.9); MVP instrumentado pra detectar degradação |
| UDP inbound bloqueado na VPS quebra WebRTC | Alta | Alto | ICE-TCP/NAT 1:1 (7.1) — fix herdado do AstraCalls |
| Instabilidade de sessão whatsmeow (desconexão) | Média | Médio | Re-pareamento (7.3), monitor (7.9) |
| Licença AGPL contaminar produto | Baixa | Alto | Base MIT (WaCalls), AstraCalls só referência; jurídico só no cenário SaaS |
| BI não contar a ligação | Baixa | Médio | Confirmado: `type='outbound'` + user em `source_user_mapping` → conta sozinho (7.7) |

## Definition of Done (Epic)

- Um SDR consegue: parear número, receber passo "Ligação via WhatsApp" na fila, ligar via WhatsApp pelo navegador, registrar disposition, e a cadência avança/reagenda.
- A ligação aparece nas métricas de Ligação (app) e na produtividade do SDR (BI).
- Gravação + consentimento funcionando.
- Quality gate verde em todas as stories.
