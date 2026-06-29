# Sessão 2026-06-29 — Epic 7: Ligação via WhatsApp (app-side completo)

**Agentes:** @dev (Dex) · @devops (Gage) · @po (Pax) · @qa (Quinn) · **Branch base:** main

## Resumo

Partiu de um ajuste pequeno na sidebar de cadência ("WhatsApp Ligação" + rename "WhatsApp Msg") e virou a **construção completa do app-side do Epic 7** (discador WhatsApp-nativo, à la Meetime). Plano → epic + 9 stories → validação @po → implementação story-a-story → QA gate. **8/9 stories no `main`** (a 7.1 é microserviço Go em repo separado, fora deste projeto).

## O que entrou na `main` (PRs)

| PR | Conteúdo |
|----|----------|
| #102 | feat sidebar (WhatsApp Ligação + WhatsApp Msg) + plano + epic-7 + 9 stories (docs) |
| #103 | stories 7.1–7.9 validadas @po → `Ready` |
| #104 | **7.2** data model (`cadence_steps.call_provider`, tabela `whatsapp_call_sessions`) |
| #105 | **7.4** passo no builder (provider ponta-a-ponta + gate na fila) |
| #106 | **7.3** pareamento de número por SDR (tela manager-only) |
| #107 | **7.6** disposition→avanço/callback + card "Ligação WhatsApp" em Integrações |
| #108 | **7.5** painel WebRTC click-to-call (shell; perna de mídia isolada) |
| #109 | **7.7** persistência call+interaction → BI (conta sozinho) |
| #110 | **7.8** gravação sempre-ON + LGPD (reusa pipeline existente; SPICED pega automático) |
| #112 | **7.9** anti-ban (teto 24h + saúde por número) |
| #113 | QA fixes F1/F2 (+14 testes: voice-service-client + smoke de componentes) |

Módulo: `src/features/whatsapp-calls/`. Plano: `docs/plans/whatsapp-call-activity-plan.md`. Runbook: `docs/runbooks/whatsapp-call-antiban.md`. QA gate: `docs/qa/epic-7-whatsapp-call-qa-gate.md`.

## QA gate do epic: **CONCERNS** (aprovado com observações)

- Segurança ✅ (API key server-only, RLS correta, guards), No-regressions ✅ (1475 testes), Docs ✅.
- F1/F2 (lacunas de teste) **fechados** (#113).
- **Gates de ativação pendentes (F3/F4/F5):** smoke dos filtros jsonb com 1ª ligação real; `recording_url` baixável pelo cron; **aplicar migrations**.

## Coexistência com PR #111 (paralelo, alinhado)

#111 persistiu as variações da sidebar (`activity_type_variations` + `call_provider`) — verificado: **estende o threading de `callProvider` do 7.4 com a MESMA convenção**, sem conflito/duplicação. Duas colunas `call_provider` em camadas distintas (paleta × passo salvo), corretas.

## ⚠️ Pendências de ativação (NADA no ar ainda)

1. **Migrations não aplicadas** (7.2 + as do #111) → rodar no Supabase staging/prod (Coolify não roda migration).
2. **Env `WACALLS_BASE_URL`/`WACALLS_API_KEY`** → configurar no Coolify.
3. **7.1 microserviço de voz (Go, base WaCalls MIT)** → construir (repo separado). Quando existir, só `voice-call-media.ts` muda (RTCPeerConnection + SDP /webrtc + SSE /events).
4. **LGPD** texto/retenção (`constants.ts` `TODO(jurídico)`).

Estado em memória: `whatsapp-call-epic-status.md`.

## Próximos passos sugeridos

- Aplicar migrations + configurar env (pré-ativação) e tratar F3/F4 na 1ª ligação real.
- Iniciar o **7.1** (fora deste repo).
- Opcional: otimizar o N+1 de `getUserById` na tela de Números WhatsApp.
