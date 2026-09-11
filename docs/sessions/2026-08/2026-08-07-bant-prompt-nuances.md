# Sessão 2026-08-07 (cont.) — Revisão do prompt de qualificação (BANT) para capturar nuances

**Agentes:** @dev (Dex) · @devops (Gage) · **Branch base:** main

## Resumo

Continuação após o handoff #239. Única frente: revisar o prompt que extrai a **qualificação (BANT) das ligações** para capturar **nuances** de vendedor. Mergeado (#240).

## O que entrou na `main` (PRs)

| PR | Commit | Conteúdo |
|----|--------|----------|
| #240 | `9976bc3` | prompt de qualificação captura nuances (termômetro, ganchos, estilo) |

## Contexto

O prompt de BANT vive em **`src/features/ai/prompts/bant-analysis.ts`** (`buildBantAnalysisPrompt`) e é **compartilhado por VOIP, WhatsApp e o "Gerar BANT via IA" manual** — a fonte da transcrição muda (API4COM / AstraCalls-WaCalls / texto colado), mas o prompt é o mesmo. Callers: `transcription.service.ts` (`analyzeAndSaveBant`, automático pós-transcrição) e `generate-bant-from-text.ts` (manual). Campos extraídos = 4 BANT (B/A/N/T, 1200 chars) + Oportunidades (700) + Gaps (700, por categoria) + Observação Decisor. Mapeamento `promptName → dbName` (custom_fields por `field_name`).

**Diagnóstico (a partir de saídas reais):** o prompt já era bom (honesto, não inventa, capta números/decisor). Fraquezas: (1) quando não tinha info, escrevia parágrafo sobre a ausência + especulava; (2) misturava fato e achismo; (3) muros de texto (2.500–2.800 chars) com a frase-chave enterrada.

## Pedido do gestor

Capturar **nuances** que o vendedor sente e o closer não vê na transcrição. Exemplos:
- "essa é fechamento, só puxar"
- "pretende contratar no próximo mês, mas se você der uma puxada ele vem"
- "ele é mais direto ao ponto, não enrola"
- "ele gosta do presidente Lula" / "adora falar de política"

## Mudança (#240, só no prompt)

**Nuances (novo):**
- **TERMÔMETRO** de fechamento + como puxar → `Observação Decisor` + `Timing` (ganhou "dá pra acelerar").
- **GANCHOS de rapport** — gostos/paixões que engajam (política, futebol, família, quem admira) → `Observação Decisor`.
- **ESTILO** (direto ao ponto vs prolixo) → `Observação Decisor`.

**Precisão/tom (alinhado antes):**
- **Punchline primeiro** em cada campo.
- **Sem encher linguiça** (limites = teto, não meta; não escrever parágrafo só pra dizer que não teve info).
- Separar **FATO de IMPRESSÃO** (achismo não vira fato; só registrar gostos/temperatura que o lead **realmente** demonstrou — trava anti-invenção).

**Estrutural:** `Observação Decisor` 500→700 chars. Demais campos, limites e mapeamento prompt→DB **inalterados**. Sem mudança de banco.

## Verificação / merge

`pnpm typecheck`, `pnpm lint`, `pnpm build` ✅; 44 testes de AI. ⚠️ O merge levou um **502 do GitHub** na resposta (ficou "merge already in progress"); o retry após ~mergeState CLEAN concluiu — nada perdido.

## Pendência / follow-up

- **Calibrar:** é subjetivo e o efeito é gradual. Acompanhar as próximas 3–4 qualificações reais e ajustar o texto se algo exagerar (ex.: inventar "gostos" — a trava fato×impressão existe, mas vale conferir).

## Pendências herdadas (não desta frente)

- Grupo de WhatsApp do lead Imperius Fitness (reunião 08/08 09h) — Matheus re-agenda OU criar endpoint "recriar grupo".
- Novo tenant **Jll Roque & Co** — provisionar em `/admin/create`.
- Re-rodar `check-api4com-config` do ramal 1042 (Pending Actions da memória).
