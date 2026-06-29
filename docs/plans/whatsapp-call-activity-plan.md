# Plano de Implementação — Atividade "Ligação via WhatsApp" (click-to-call nativo)

> **Status:** Plano (não implementado). Discovery via MCP Supabase (read-only) nos projetos `dhkmonctyoaenejemkrt` (Enriquece) e `ejxlbbbjyexsoltsxiqq` (V4 Sales/BI) + leitura de código + READMEs WaCalls/AstraCalls.
> **Autor:** @dev (Dex) · **Data base:** 2026-06-28 · **Escopo:** MVP click-to-call humano → evolução.

---

## 0. Avaliação executiva (minha leitura antes do plano)

**Vale a pena? Sim, com escopo apertado.** A lógica é sólida: o modo de falha que matou a tentativa anterior (bloqueio de operadora no API4COM, ~73-76% de falha) **não existe no transporte WhatsApp** — não há camada PSTN/operadora. E o stack do Enriquece está surpreendentemente pronto: a engine de cadência já trata todo canal ≠ `email` como atividade manual na fila do SDR, a tabela `calls` já tem `connected/answered_at/duration_seconds/recording_url/transcription`, e existe disposition (`call_status`) + avanço atômico (`advance_enrollment_after_step`). **A maior parte do trabalho é o microserviço de voz + a perna WebRTC no front, não a cadência.**

**Onde eu ajusto as premissas do briefing:**

- **Não criar `channel_type='whatsapp_call'`.** Recomendo reusar `channel='phone'` (já foi a decisão de produto na sidebar há 2 commits: "WhatsApp Ligação" conta como Ligação) e discriminar por uma coluna nova em `cadence_steps` (ex.: `call_provider`) + `calls.metadata.provider='whatsapp'`. Isso evita (a) o gotcha de `ALTER TYPE ... ADD VALUE` dentro de transação, (b) o fan-out de ~10 `Record<ChannelType,...>` no front, e (c) mantém as métricas de Ligação unificadas automaticamente. Custo: a UI precisa de **um discriminador por step** pra saber se renderiza o discador WhatsApp (WebRTC) ou o click-to-call API4COM atual.
- **Vantagem de tracking que o briefing não previu:** o microserviço de voz emite o ciclo de vida real da chamada (ringing → answered → ended) via SSE. Logo `calls.connected` e `calls.answered_at` são **autoritativos** — a ligação WhatsApp **não sofre** a misclassificação de connect-rate que o API4COM sofre (memória: PR #51, fallback por duração). Aqui a gente seta o sinal direto.
- **Risco nº1 não é técnico, é ban.** Número por SDR é a aposta certa, mas o gargalo do MVP é descobrir a **tolerância da Meta a volume de chamadas VoIP saindo de um número** — não há SLA público. O MVP tem que ser instrumentado pra detectar degradação (taxa de "não toca"/erro de sessão) antes de escalar.
- **Licença:** WaCalls é MIT (ok importar). AstraCalls é AGPL-3.0 (**não importar código**; só referência de arquitetura). A fronteira só vira problema jurídico de verdade no cenário SaaS externo (ProspectAI) — registrar como decisão p/ jurídico, não bloquear o MVP interno.

**Veredito:** GO para um MVP de 1 SDR / 1 número / disposition manual, com o objetivo único de medir **connect rate e taxa de atendimento**. Esforço realista do MVP: **~3-4 semanas** (a maior fatia é o microserviço de voz em VPS com o fix de NAT/ICE-TCP, não o Enriquece).

---

## Fase 0 — Discovery (achados REAIS)

### 0.1 Schema do Enriquece (`dhkmonctyoaenejemkrt`) — confirmado ao vivo

**Enums relevantes (`pg_enum`):**

| Enum | Valores |
|------|---------|
| `channel_type` | `email, whatsapp, phone, linkedin, research, calendar, system, crm` |
| `interaction_type` | `sent, delivered, opened, clicked, replied, bounced, failed, meeting_scheduled, crm_synced, crm_deal_created` |
| `enrollment_status` | `active, paused, completed, replied, bounced, unsubscribed` |
| `call_status` (disposition) | `significant, not_significant, no_contact, busy, not_connected` |
| `call_type` | `inbound, outbound, manual` |

**`cadence_steps`** (colunas-chave): `id, cadence_id, step_order, channel (channel_type), template_id, delay_days, delay_hours, ai_personalization, activity_name, instructions, reply_type, + A/B (template_id_b, ab_*)`.
→ **Não há** coluna que distinga "tipo de ligação". Precisamos adicionar um discriminador (ver Fase B).

**`cadence_enrollments`**: `id, cadence_id, lead_id, current_step, status, next_step_due, enrolled_by, enrolled_at, completed_at, loss_reason_id, loss_notes, scheduled_start_at, org_id`.

**`calls`** (já rica — reaproveitável p/ WhatsApp call): `id, org_id, user_id, lead_id, origin, destination, started_at, duration_seconds, status (call_status), type (call_type), cost, recording_url, recording_storage_path, notes, is_important, metadata (jsonb), transcription, transcription_status, transcription_error, connected (bool), answered_at, hangup_cause`.

**`interactions`**: `id, org_id, lead_id, cadence_id, step_id, channel, type, message_content, external_id, metadata (jsonb), ai_generated, original_template_id, performed_by, created_at`.

**`leads`** (telefonia): `telefone (text)`, `phones (jsonb — array {tipo: celular|fixo|whatsapp, numero})`, `socios (jsonb — celulares com flag whatsapp)`, `whatsapp_invalid_at (timestamptz — SDR marcou "não é WhatsApp")`.

**RPCs de cadência existentes:** `advance_enrollment_after_step(p_enrollment_id, p_executed_step_id, p_performed_by)` (avanço atômico, idempotente, row-locked), `close_enrollments_on_terminal_lead`, `list_overdue_enrollments_brt(p_org_id, p_cutoff)`, `leads_without_active_enrollment(p_org_id)`, `fetch_inactive_enrollment_candidates`.

### 0.2 Warehouse de BI (`ejxlbbbjyexsoltsxiqq`) — **correção crítica**

⚠️ **`get_sdr_monthly_metrics` NÃO existe.** As RPCs reais de SDR são:

| RPC | Assinatura | Papel |
|-----|-----------|-------|
| `sync_sdr_metrics` | `(p_enriquece_user_id text, p_leads_abertos int, p_ligacoes_realizadas int, p_ligacoes_conectadas int, p_pct_conectadas numeric, p_reunioes_marcadas int, p_reunioes_realizadas int)` | **Ponto de ingestão** — é AQUI que a ligação WhatsApp entra (incrementa `ligacoes_realizadas`/`ligacoes_conectadas`). |
| `sync_sdr_metrics_logged` | idem | Variante com log |
| `get_sdr_team_stats` | `(p_year int, p_month int)` | Leitura agregada do time |
| `get_sdr_overview_extras` | `(p_year, p_month)` | Extras do overview |
| `get_funil_anual_por_sdr` | `(p_year, p_pipeline_type text)` | Funil anual |
| `get_sdr_daily_evolution` / `get_sdr_reunioes_detalhe` | — | Evolução diária / detalhe reuniões |

→ Implicação: como as ligações WhatsApp vão pousar na tabela `calls` do Enriquece com `connected`/`answered_at` reais, elas entram em `ligacoes_realizadas`/`ligacoes_conectadas` **pela mesma agregação que já alimenta `sync_sdr_metrics`** — provavelmente **zero mudança no warehouse**, só garantir que a origem que conta `calls` não filtre por provider. (Validar a query de origem do Make scenario 88956 — ver decisão pendente.)

### 0.3 Código do Enriquece (arquivos-chave)

- **Engine de execução de cadência:** `src/features/cadences/actions/execute-cadence.ts` — cron auto-executa **só** `channel='email'` (`if (step.channel !== 'email') { skip }`). Todo o resto cai na fila do SDR. ✅ Ligação WhatsApp (channel=phone) já seria tratada como manual sem tocar nada aqui.
- **Avanço pós-atividade:** `src/features/activities/actions/execute-activity.ts` → RPC `advance_enrollment_after_step`. Dedup de interactions de telefone (reusa `interactions` channel=phone sem cadence_id criado nos últimos 30min).
- **Fila do SDR:** `src/features/activities/actions/fetch-pending-activities.ts` (gate: suprime step whatsapp se `lead.whatsapp_invalid_at`), `components/ActivityQueueView.tsx` (grupos de prioridade + countdown via `nextStepDue`), `components/ActivityExecutionSheetContent.tsx` (branch por canal).
- **Painéis de execução por canal:** `ActivityPhonePanel` (telefone/disposition), `ActivityWhatsAppCompose` (msg WhatsApp), `ActivitySocialPointPanel`, `ActivityResearchPanel`, `ActivityEmailCompose`.
- **Resolução de número WhatsApp:** `src/features/activities/utils/resolve-whatsapp-phone.ts` — `getAllLeadPhones()` / `resolveWhatsAppPhone()` já priorizam sócio-celular com `whatsapp:true` → `phones[tipo=whatsapp]` → demais. ✅ Reaproveitável direto como gate de elegibilidade.
- **Tracking de ligação atual (API4COM):** `src/features/calls/` + `src/app/api/workers/reconcile-api4com-calls/route.ts` (worker horário que faz upsert na `calls`). Disposition = enum `call_status`.

### 0.4 Microserviço de voz — endpoints a consumir (WaCalls/AstraCalls)

Ambos expõem a **mesma superfície REST** (AstraCalls = superset). O Enriquece consome:

| Método | Rota | Uso no MVP |
|--------|------|-----------|
| `POST /api/sessions` | criar conta + iniciar pareamento QR | setup do número do SDR (1x) |
| `GET /api/sessions` | listar contas (status, paired) | health/pairing |
| `POST /api/sessions/{sid}/pair` | novo QR (re-pareamento) | recuperação de sessão |
| `POST /api/sessions/{sid}/calls` | **iniciar chamada** `{ phone, duration_ms?, record? }` | botão "Ligar via WhatsApp" |
| `POST /api/sessions/{sid}/calls/{id}/webrtc` | **troca de SDP WebRTC** | handshake do mic do SDR |
| `DELETE /api/sessions/{sid}/calls/{id}` | encerrar chamada | desligar |
| `GET /api/sessions/{sid}/history` | histórico (≤50) | reconciliação |
| `GET /api/events` | **SSE** (lifecycle: ringing/answered/ended) | estados de UI + webhook→BI |

**Auth:** WaCalls não tem auth (LAN-only) → **temos que adicionar API key** (AstraCalls já tem: `X-API-Key` / `?apiKey=` p/ SSE) — reimplementar, não importar.
**Webhook por sessão:** AstraCalls tem `GET/POST/DELETE /api/sessions/{sid}/webhook` — **reimplementar** no nosso fork MIT p/ empurrar evento ao n8n.
**NAT/cloud:** `WACALLS_PUBLIC_IP=auto` + `WACALLS_UDP_PORT` (SetNAT1To1IPs + ICE-TCP fallback no mesmo port) — **essencial** porque VPS costuma bloquear UDP inbound. Network mode `host` no Docker.
**Áudio (só relevante p/ fase IA futura):** mic do navegador → PCM 16 kHz via datachannel → MLow (Go puro) → SRTP relay do WhatsApp.

### 0.5 Lacunas / a confirmar

- Query de origem do `sync_sdr_metrics` (Make 88956): confirmar que conta `calls` de forma provider-agnóstica.
- Tolerância de volume de chamadas VoIP por número antes de risco de ban (sem fonte pública — descobrir empiricamente no MVP).
- Onde guardar o `session_id`/número↔SDR (nova tabela `whatsapp_call_sessions` — ver Fase B).

---

## Fase 1+ — Plano de implementação

### A. ADR (Architecture Decision Record)

| Decisão | Recomendação | Justificativa | A validar |
|---------|--------------|---------------|-----------|
| **Isolamento do serviço de voz** | Microserviço Go separado, REST, deploy próprio na VPS (Docker, network host) | whatsmeow+pion+MLow não cabem no runtime Next; processo isolado por sessão WhatsApp | — |
| **Licença** | Base **WaCalls (MIT)**; AstraCalls só como **referência** (reimplementar auth/webhook/session-pg/widget) | AGPL-3.0 contamina serviço em rede; Enriquece é proprietário | Fronteira p/ jurídico **só** no cenário SaaS ProspectAI |
| **Modelo de canal** | **Reusar `channel='phone'`** + discriminador `cadence_steps.call_provider` + `calls.metadata.provider='whatsapp'` (NÃO criar enum novo) | Evita gotcha `ALTER TYPE` em tx, evita fan-out de ~10 maps no front, unifica métricas de Ligação | — |
| **Modelo de sessão** | **1 número por SDR** | distribui risco de ban, mantém identidade de quem liga | ✅ confirmado |
| **Gravação** | **ON no MVP** — exige fluxo de consentimento/LGPD no início da chamada | decisão de produto (Vinícius) | ✅ confirmado — **bloqueia: aviso de consentimento obrigatório** |
| **`calls.type` da ligação WhatsApp** | **`type='outbound'`** + `metadata.provider='whatsapp'` | garante contagem em TODA agregação (há overload BI dormente que filtra `type='outbound'`; provável que o dashboard interno de Ligações também filtre) | ✅ confirmado |
| **Sinal de connect** | Lifecycle do SSE do serviço de voz → seta `calls.connected`/`answered_at` direto | autoritativo; evita misclassificação tipo API4COM (PR #51) | — |

### B. Data model (DDL proposto — NÃO aplicar ainda)

Forward-only, padrão do projeto (`BEGIN/COMMIT`, `IF NOT EXISTS`, trigger `set_updated_at`/`update_updated_at()`, RLS org-scoped com `public.user_org_id()`/`public.is_manager()`).

**B.1 Discriminador no step** (sem mexer no enum `channel_type`):
```sql
ALTER TABLE cadence_steps
  ADD COLUMN IF NOT EXISTS call_provider text;   -- NULL = ligação comum (API4COM/PSTN); 'whatsapp' = discador WhatsApp
-- (channel continua 'phone' para o step)
```

**B.2 Sessões WhatsApp por SDR** (número↔SDR↔session do microserviço):
```sql
CREATE TABLE IF NOT EXISTS whatsapp_call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,                 -- SDR dono do número
  service_session_id text NOT NULL,      -- {sid} no microserviço de voz
  phone_number text NOT NULL,            -- número pareado (identidade da chamada)
  status text NOT NULL DEFAULT 'disconnected', -- connected|disconnected|pairing
  paired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE whatsapp_call_sessions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_call_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- RLS: SELECT/ALL org-scoped via public.user_org_id(); manager vê todos, SDR só o seu.
```

**B.3 Eventos de chamada → reusar a tabela `calls`** (sem tabela nova):
- Insert em `calls` com **`type='outbound'`** (NÃO `'manual'` — ver §F: garante contagem no BI e no dashboard interno), `metadata = {provider:'whatsapp', service_call_id, service_session_id}`, `status` (disposition `call_status`), `connected`, `answered_at`, `duration_seconds`, `hangup_cause`, `recording_url`.
- Insert em `interactions` com `channel='phone'`, `type='sent'`, `step_id`, `cadence_id`, `metadata.provider='whatsapp'` → flui pras métricas de Ligação e BI sem código novo de agregação.

**B.4 Gate de elegibilidade:** sem coluna nova — reusar `resolveWhatsAppPhone(lead)` + `whatsapp_invalid_at`. O step `call_provider='whatsapp'` só fica "executável" se `getAllLeadPhones(lead)` retornar ≥1 número whatsapp e `whatsapp_invalid_at IS NULL`.

### C. Serviço de voz (spec de consumo)

- **Fork MIT do WaCalls** + reimplementar (referência AstraCalls): API key auth, webhook por sessão, NAT 1:1/ICE-TCP, (opcional) Postgres por sessão.
- **Contrato que o Enriquece consome** (via uma Server Action/route handler proxy que injeta a API key — o browser nunca fala direto com o serviço):
  - `iniciar`: `POST /api/sessions/{sid}/calls {phone, record:false}` → `{call_id}`.
  - `SDP`: `POST /api/sessions/{sid}/calls/{id}/webrtc {sdp}` ⇄ `{sdp}` (browser ↔ serviço).
  - `encerrar`: `DELETE /api/sessions/{sid}/calls/{id}`.
  - `estados`: assinar `GET /api/events?apiKey=...` (SSE) → mapear `ringing|active|ended|rejected|no-answer`.
- **Sessão por SDR:** `{sid}` = `whatsapp_call_sessions.service_session_id` do `user_id` logado.
- **Deploy alvo:** VPS própria, Docker network=host, `WACALLS_PUBLIC_IP=auto`, `WACALLS_UDP_PORT=<porta>`, `WACALLS_API_KEY=<forte>`. Traefik/socat p/ HTTPS.
- **Estados tratados:** chamando (ringing) / ativo (answered → inicia cronômetro) / encerrado / rejeitado / sem resposta → cada um mapeia disposition default sugerido (ver E).

### D. Frontend (tela de execução do SDR)

- Novo painel `ActivityWhatsAppCallPanel` (irmão de `ActivityPhonePanel`), renderizado quando `step.channel==='phone' && step.call_provider==='whatsapp'`.
- Espelha o padrão do `widget.js` do AstraCalls, mas **nativo no nosso React**: botão "Ligar via WhatsApp", captura mic (getUserMedia), handshake WebRTC (pion no serviço), card "Chamando…" até `answered`, **cronômetro só na conexão de mídia real**, auto-toque em chamada recebida (fase futura).
- Número de destino: `resolveWhatsAppPhone(lead)`; se múltiplos, seletor (reusa `getAllLeadPhones`).
- Ao desligar: abre captura de **disposition** (mesmo seletor do `ActivityPhonePanel`, vocabulário `call_status`). Disposition gravada **fecha a atividade** e dispara o avanço (ver E).
- Estados de UI: `idle → requesting-mic → ringing → active(timer) → ended(→disposition)` e erros (`mic-denied`, `session-disconnected`, `service-error`).

### E. Disposition → avanço de cadência

Reusa `advance_enrollment_after_step`. Mapa (vocabulário `call_status`):

| Disposition (`call_status`) | Default de UI | Ação na cadência |
|----------------------------|---------------|------------------|
| `significant` (conversa relevante) | atendeu + falou | conclui step → avança; abre próximo passo (ex.: agendar reunião) |
| `not_significant` (atendeu, sem avanço) | atendeu | conclui step → avança normal |
| `busy` (ocupado) | — | conclui tentativa → **reagenda** mesmo step (retry curto) |
| `no_contact` (não atendeu/sem resposta) | ringing→ended sem answered | conclui tentativa → reagenda/avança conforme política de tentativas |
| `not_connected` (sessão/erro técnico) | service-error | **não conta** como tentativa de contato; reabre na fila |

→ Disposition é **manual** no MVP (SDR escolhe). O lifecycle do SSE só **pré-seleciona** o default (ex.: nunca houve `answered` → sugere `no_contact`).

### F. Pipeline de eventos → BI (caminho REAL confirmado via MCP)

**Pipeline existente (n8n workflow `nJK3px1s2WLTthqj` "V4 Flux <> Enriquece AI > Sync Calls", ativo):**
```
webhook /calls  →  RPC get_calls_for_v4sales(p_from_date)  [Enriquece dhkmonctyoaenejemkrt]
               →  RPC sync_calls_from_enriquece_logged(p_calls)  [warehouse ejxlbbbjyexsoltsxiqq]
```
- `get_calls_for_v4sales(p_from_date)` puxa **TODAS** as calls da org V4 desde `v_from` (sem filtro de `type`, traz `metadata`).
- `sync_calls_from_enriquece(p_calls)` no warehouse: para cada call mapeia o SDR via `source_user_mapping` (source='enriquece_ai'); insere em `call_logs` (dedup por `metadata.api4com_call_id` **ou** `id`); agrega em `pdi_monthly_goals`: `ligacoes_realizadas = COUNT(*)`, `ligacoes_conectadas = COUNT(connected)`, onde **`connected` é RECALCULADO lá** como `status='significant' OR duration_seconds>=30`.

**✅ Conclusão: ZERO mudança no warehouse.** A ligação WhatsApp conta sozinha, desde que a call exista em `calls` com: `org_id`=V4, `user_id` do SDR **mapeado em `source_user_mapping`**, `started_at` no mês, e `status` (disposition) preenchida. Só precisamos **disparar o webhook `/calls`** após gravar a call (ou deixar o cron/watchdog existente puxar).

**Ressalvas / armadilhas a respeitar:**
1. **`type='outbound'`** na call WhatsApp (decisão #5): o caminho ativo não filtra type, mas o overload `get_calls_for_v4sales(p_year,p_month)` filtra `type='outbound'` e provavelmente o dashboard interno de Ligações também → usar `outbound` blinda contra todos.
2. **`connected` do BI ≠ nossa coluna `calls.connected`**: lá é `significant OR ≥30s`. Pra ligação curta atendida (<30s) contar como conectada, marcar disposition `significant`.
3. **`source='api4com'`** no `pdi_monthly_goals` (rótulo herdado, cosmético — não afeta contagem).
4. **SDR precisa estar em `source_user_mapping`** (já está se ele já faz ligações API4COM).

**Padrões n8n obrigatórios (nossos):**
- Após `update_workflow`, **`publish_workflow`** (senão produção roda versão velha).
- **Sem** header `Accept: application/vnd.pgrst.object+json` em nodes HTTP contra views (usar array).
- Funções: `DROP FUNCTION IF EXISTS nome(params)` antes de `CREATE OR REPLACE`; depois `NOTIFY pgrst, 'reload schema'` + aguardar 1-2min.
- Views: mudou ordem de coluna → `DROP VIEW` + `CREATE VIEW`.
- Cross-project: extract-then-embed.

> ⚠️ **Dívida de segurança observada (pré-existente, fora de escopo):** o node "Sync Calls" tem a **service_role JWT do Enriquece hardcoded** na config do n8n. Não é introduzido por este plano, mas vale registrar pra rotação futura.

### G. Anti-ban / operação

- **1 número dedicado por SDR** (não pessoal).
- **Limites diários de cadência:** reusar o padrão `controle_disparo` que já roda na Maskavo (teto de chamadas/dia por número).
- **Posicionamento:** reativação/aquecimento de base que **já nos conhece** (não cold spam em escala) — reduz denúncia → reduz ban.
- **Instrumentação de saúde:** monitorar taxa de `not_connected`/erro de sessão por número; alerta se degradar (sinal precoce de throttle/ban).

### H. Gravação → transcrição (opção, fora do MVP por padrão)

- `POST /calls {record:true}` → `calls.recording_url`/`recording_storage_path`.
- Pipeline: gravar → transcrever (`transcription_status` já existe na `calls`) → realimentar coaching/playbook (mesmo loop que gerou o playbook de reativação).
- **LGPD:** aviso de consentimento no início da chamada + base legal. Só ligar `record:true` quando esse fluxo existir.

---

## Escopo do MVP (guardrails)

**MVP =** 1 SDR · 1 número dedicado · click-to-call **humano** · disposition **manual** · evento na `calls`/`interactions` → BI.
**Objetivo do MVP:** validar **connect rate** e **taxa de atendimento** antes de generalizar.

**Fora do MVP:** agente de IA autônomo (Gemini Live/Pipecat na perna PCM); trocar Evolution API pela API de mensagens do AstraCalls (citar como oportunidade); Chatwoot; multi-número em pool; gravação/transcrição.

---

## Estimativa de esforço (faseada)

| Fase | Entregável | Arquivos/tabelas | Esforço | Risco |
|------|-----------|------------------|---------|-------|
| **1. Voz/infra** | Fork MIT WaCalls + API key + webhook + deploy VPS (NAT/ICE-TCP) | repo Go separado, Docker, Traefik | **M-L (1.5-2 sem)** | **Alto** (NAT/UDP em cloud, estabilidade de sessão) |
| **2. Data model** | `cadence_steps.call_provider`, `whatsapp_call_sessions`, RLS | 2 migrations Enriquece | **S (1-2 dias)** | Baixo |
| **3. Sidebar/builder** | "Ligação via WhatsApp" como step `phone`+`call_provider='whatsapp'` (evolui o item já criado) | `ActivityTypeSidebar.tsx`, `StepEditorDialog.tsx`, schemas | **S (1-2 dias)** | Baixo |
| **4. Painel de execução** | `ActivityWhatsAppCallPanel` (WebRTC mic + estados + disposition) | `features/activities/components/*` | **M (3-5 dias)** | Médio (WebRTC no browser) |
| **5. Disposition→avanço** | mapa `call_status`→ação, fecha atividade, `advance_enrollment_after_step` | `execute-activity.ts` + action nova | **S (2 dias)** | Baixo |
| **6. Eventos→BI** | webhook voz→n8n→`calls`/`interactions`; confirmar `sync_sdr_metrics` | n8n workflow + route handler | **S-M (2-3 dias)** | Médio (validar origem 88956) |
| **7. Anti-ban/observabilidade** | limite diário + monitor de saúde de número | reusar `controle_disparo` + dashboard | **S (1-2 dias)** | — (mitiga risco do MVP) |
| **(futuro) Gravação/IA** | record→transcrição→coaching; agente IA | — | **L+** | — |

**Total MVP (fases 1-7): ~3-4 semanas**, gargalo na Fase 1.

---

## Decisões — log (resolvidas em 2026-06-28) + abertas

| # | Tema | Resolução |
|---|------|-----------|
| 1 | Número por SDR vs pool | ✅ **1 número por SDR** |
| 2 | Gravação no MVP | ✅ **ON** → adiciona requisito **bloqueante**: aviso de consentimento/LGPD no início da chamada (Fase H entra no MVP, não fica como futuro) |
| 5 | `call_type` da call WhatsApp | ✅ **`type='outbound'` + `metadata.provider='whatsapp'`** (revisado após achar o filtro `type='outbound'` no BI — §F) |
| 6 | BI conta a ligação? | ✅ **Sim, zero mudança no warehouse** (caminho `get_calls_for_v4sales` → `sync_calls_from_enriquece`, §F). Ressalvas em §F. |

| 3 | Disposition "reagendou" (callback) | ✅ **Opção (a): reabre o mesmo step** com `next_step_due` escolhido pelo SDR (snooze Meetime-like), mantém `current_step`/`status='active'`, sem avançar. **Implica:** action nova "reagendar step atual" (seta `next_step_due` sem chamar `advance_enrollment_after_step`) — adicionar à Fase 5. |
| 4 | Fronteira de licença | ✅ **Manter fronteira**: base WaCalls (MIT), AstraCalls só referência (reimplementar, **não** importar código). Jurídico **só** se/quando ProspectAI/SaaS externo. Esclarecimento: AGPL-3.0 obriga a oferecer o fonte a quem usa o serviço em rede — risco real só no cenário SaaS externo; uso interno + base MIT evita. |

**Nenhuma decisão aberta restante.** Plano pronto pra virar epic/stories.
```
