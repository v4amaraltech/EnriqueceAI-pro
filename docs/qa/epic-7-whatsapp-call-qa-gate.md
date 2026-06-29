# QA Gate — Epic 7: Ligação via WhatsApp

**Revisor:** @qa (Quinn) · **Data:** 2026-06-29 · **Escopo:** app-side completo (stories 7.2-7.9, PRs #104-#112), módulo `src/features/whatsapp-calls/` + wiring em `activities`.

## Veredito: **CONCERNS** — aprovado com observações

O epic está **bem estruturado, seguro e testado na camada de lógica**, sem regressões. Os CONCERNS decorrem majoritariamente da decisão deliberada de entregar o **app-side como shell + boundary** (dependente do microserviço 7.1, inexistente) — não de defeitos. **Nada bloqueia merge** (já mergeado); o que falta é **verificação em runtime** (impossível sem ativação) + algumas lacunas de teste.

## 7 Checks

| # | Check | Resultado | Nota |
|---|-------|-----------|------|
| 1 | Code review | ✅ PASS | Convenções seguidas; isolamento do 7.1 limpo (`voice-call-media.ts`); sem `executeActivity` no fluxo WhatsApp (evita avanço duplo — confirmado) |
| 2 | Unit tests | ✅ PASS (pós-fix) | Lógica coberta + **F1/F2 fechados (29/jun): +14 testes** — `voice-service-client` (9: normalize/mapStatus/jidToPhone/erros) e smoke dos componentes (panel, manager, disposition form) |
| 3 | Acceptance criteria | ⚠️ CONCERNS | ACs do app-side atendidas; ACs de mídia (áudio real, SSE de atendimento) **diferidas ao 7.1 por decisão de produto** (shell). "Atendeu" é manual até lá |
| 4 | No regressions | ✅ PASS | Suíte completa 1461 ✓; caminhos de gravação **API4COM intocados**; testes existentes fortalecidos |
| 5 | Performance | ⚠️ CONCERNS | Página `whatsapp-numbers` faz N+1 `auth.admin.getUserById` (1/membro) — espelha a tela de Usuários, mas vale otimizar p/ orgs grandes |
| 6 | Security | ✅ PASS | `WACALLS_API_KEY` só no servidor (voice-service-client importado só por server actions); guards corretos (manager no pareamento, SDR nas chamadas); RLS org-scoped correta; zod em todas as actions; untrusted-data do MCP respeitado |
| 7 | Documentation | ✅ PASS | Stories + plano + runbook anti-ban + memória; LGPD texto/retenção em `constants.ts` com `TODO(jurídico)` |

## Findings (para @dev / @devops)

### Pré-ativação — ✅ RESOLVIDO (29/jun)
- **F1 ✅ FECHADO** — `voice-service-client.test.ts` (9 testes): config, API-key header, normalização (paired→connected, jid→phone, qr), e erros (`not_configured`/`request_failed`).
- **F2 ✅ FECHADO** — smoke por componente: `ActivityWhatsAppCallPanel` (idle + aviso + dial), `WhatsAppNumbersManager` (uso/badge/ação), `CallDispositionForm` (5 opções + picker de callback).

### Verificações pós-ativação (não dá pra testar agora)
- **F3 (alto p/ confiança) — smoke dos filtros jsonb**: `.eq('metadata->>provider','whatsapp')` (limite diário, agregação da página) e `.eq('metadata->>service_call_id', …)` (dedup) — sintaxe PostgREST padrão, mas **sem dados WhatsApp reais** ainda. Validar com a 1ª ligação real.
- **F4 (alto) — `recording_url` baixável pelo cron**: o `persist-pending-recordings` faz `fetch(url)` simples. Se o serviço de voz (7.1) exigir auth na URL da gravação, expor URL pública/assinada ou proxiar — senão a gravação não armazena/transcreve.
- **F5 — migrations 7.2 não aplicadas**: schema/RLS/trigger **nunca executados** em nenhum ambiente. Aplicar e validar (o checklist deploy-verification cobre isso).

### Itens definicionais / aceitos (WAIVED)
- **W1 — "Atendeu" manual** e ausência da perna WebRTC: aceito (decisão "shell + boundary 7.1").
- **W2 — LGPD texto/retenção pendente jurídico**: aceito como GO-condicional (mecanismo pronto).
- **W3 — limites anti-ban como constantes globais**: aceito (MVP calibra empiricamente).

## Conclusão
Qualidade alta para um app-side que conscientemente depende de um serviço externo ainda inexistente. **Gate: CONCERNS** — seguir com F1/F2 (teste) quando possível e tratar F3/F4/F5 como **gates de ativação** antes de expor o discador a SDRs reais.
