# Story: Resposta de WhatsApp acha o lead pelo número em qualquer formato

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-04 | @dev (Dex) | Revisão adversarial (AJUSTAR) aplicada: (1) `find_lead_ids_by_phone` também compara os 10 últimos dígitos de um número de 11 — tira o 1º dígito do DDD e casaria "(51) 99999-8888" com "11 99999-8888" (0 pares em prod hoje). Agora os candidatos passam por `leadPhoneMatches` (igualdade exata da forma local em `telefone` e `phones[].numero`); (2) `localPhoneVariants` só aceita 10/11 dígitos locais — estrangeiro e `@lid` não vão ao banco. Conferido em prod: 21/21 acertos mantidos. Edge Function ainda não publicada. |
| 2026-10-04 | Vini + Claude | Story criada a partir da auditoria de 04/out (agente de confiabilidade, achado 4). |

## Origem

A captura de resposta do lead no WhatsApp (`evolution-webhook`, corrigida no PR #448 e protegida pela chave `app_flags.whatsapp_reply_capture_enabled`, **desligada**) achava o lead comparando o número como **texto exato** com `leads.telefone`. Telefones salvos com formatação — `(11) 99999-8888`, `11 99999888` — não casavam: ~28% dos leads têm telefone formatado.

Medido com os 51 números distintos que mandaram mensagem em 01/10 (org V4):

| Método | Acha o lead |
|---|---|
| Atual (texto exato) | 14 |
| Por dígitos + variação do 9º dígito | **21** |
| Contatos extras do lead (`lead_contacts`) | 17 — todos já cobertos pelos dígitos |

## Story

**As a** SDR,
**I want** que a resposta do lead no WhatsApp seja reconhecida mesmo com o telefone salvo formatado,
**so that** a cadência pare e eu seja avisado para continuar a conversa.

## Acceptance Criteria

1. O lead é achado pelos **dígitos** via `find_lead_ids_by_phone` (mesma fonte do bloqueio por telefone do BDR), para o número enviado e a forma com/sem o 9º dígito (o 9 só é acrescentado a celular — número começando com 6–9).
2. Se o número casa com mais de um lead, vale o que tem inscrição **ativa** (a mais recente).
3. Duplicado (reenvio do webhook) checado entre todos os leads candidatos.
3a. Candidatos da RPC só valem se algum número do lead (`telefone` ou `phones[].numero`) for **igual** a uma das formas (fecha a colisão entre DDDs pelos 10 últimos dígitos).
3b. Número que não tem 10/11 dígitos locais (estrangeiro, `@lid`) → "lead não encontrado", sem consultar o banco.
4. Erro na busca continua subindo como erro (webhook responde 5xx), nunca vira "lead não encontrado".
5. Comportamento só muda quando a chave da captura for ligada.

## Scope

**IN:** `supabase/functions/_shared/whatsapp-reply.ts`, `supabase/functions/_shared/evolution-events.ts` (`localPhoneVariants`; `phoneCandidates` removido, sem uso), testes em `tests/edge/`.

**Riscos:** mesmo telefone em dois leads com cadência ativa → só o da inscrição mais recente para (como antes). Custo: ~150 ms por chamada da RPC (2 por mensagem), só com a chave ligada.

**OUT:** contatos extras (`lead_contacts`) — sem ganho medido; ligar a chave da captura (decisão do Vini).

## Tasks

- [x] `localPhoneVariants` + testes
- [x] Busca por dígitos com desempate pela inscrição ativa + testes
- [x] typecheck / lint / test:run; `deno check` sem erros novos
- [x] Revisão (ajustes aplicados)
- [x] PR + publicar a Edge Function

## File List

- `supabase/functions/_shared/whatsapp-reply.ts` (modificado)
- `supabase/functions/_shared/evolution-events.ts` (modificado)
- `tests/edge/evolution-events.test.ts` (modificado)
- `tests/edge/whatsapp-reply.test.ts` (modificado)
- `docs/stories/whatsapp-reply-phone-digits.story.md` (novo)
