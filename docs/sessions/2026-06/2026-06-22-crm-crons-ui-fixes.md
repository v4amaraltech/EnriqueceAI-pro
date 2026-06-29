# Sessão 2026-06-22 — CRM, saúde de crons e fixes de UI

**Agente:** @devops (Gage) · **Branch base:** main

## Entregas (todas mergeadas, deployadas via Coolify e validadas)

| PR | Tema | Resumo |
|----|------|--------|
| #80 | CRM | Desliga push de contato/atividade no sync periódico (`PUSH_LEADS_TO_CRM=false` em `crm-sync.service.ts`). Kommo só recebe **deals no Ganho**; pull permanece. Validado: ciclo das 18:00 gerou 0 `crm_synced` apesar de 7 candidatos. |
| #81 | Ligações | Worker `process-pending-transcriptions` agora marca ligações curtas (<90s) como `skipped` (helper `isTooShortToTranscribe`). Impede backlog fantasma de `pending`. Backfill one-time via MCP: **1.530** curtas → `skipped` + 1 órfã `processing` resetada. Pós-deploy: `pending=0`, anti-reacúmulo confirmado. |
| #82 | Leads/UI | Dropdown de **Cargo** ganhou fallback (`DEFAULT_JOB_TITLE_OPTIONS` do `STANDARD_FIELDS`) em `LeadInfoPanel`. Ficava vazio nos surfaces que não passam `jobTitleOptions` (ex.: `ActivityLeadContext`), pois `cargoOptions` não tinha fallback como a Origem. |
| #83 | Atividades/UI | Botões do modal "Resultado da Ligação" (`ActivityPhonePanel`) reagrupados: esquerda = Cancelar/Tentar novamente, direita = Perdido/Agendar Reunião/Concluir atividade (`justify-between`). |

## Diagnósticos (sem mudança de código)

- **Evento "Lead sincronizado com o CRM"**: é `crm_synced` (contato, não deal). Disparado pelo cron `sync-crm` (a cada 30 min). Investigado lead 99868f07 — origem confirmada no cron das 16:30.
- **Inventário de crons**: 26 pg_cron ativos (mapa completo entregue ao usuário).
- **Saúde dos workers de ligações**: agendamento 100% (0 falhas/7d); transporte com ~21% de **timeout de DNS no pg_net** (5s) — afeta TODOS os crons HTTP, não só ligações, request nem chega na app (0 erros 4xx/5xx). Mitigação proposta (aumentar `timeout_milliseconds` 5s→15s) **não aplicada** — fica como follow-up opcional.

## Follow-ups em aberto (opcionais, não solicitados)

- **Mitigar DNS-timeout do pg_net** nos crons (5s→15s) — reduz ~21% de miss em todos os jobs HTTP.
- **Limpeza de contatos Kommo sem deal** (~376 candidatos; 3 "ganhos sem deal" são órfãos a investigar, não apagar). Usuário deixou de lado nesta sessão ("segue o jogo").
- **48 gravações não persistidas** (`persist-pending-recordings`) — investigação separada não feita.

## Notas

- CRON_SECRET já rotacionado em sessão anterior (antigo morto/401).
- Repo público `v4amaraltech/EnriqueceAI-pro`; deploy = Redeploy manual no Coolify; migrations/DB via MCP.
