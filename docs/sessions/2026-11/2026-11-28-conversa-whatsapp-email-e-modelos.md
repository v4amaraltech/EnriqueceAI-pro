# Handoff: abas WhatsApp/Email do lead vazias + "[Nome]" nos modelos (28/11/2026)

## Problema relatado
No histórico do lead, as abas **WhatsApp** e **Email** apareciam vazias ("Nenhum e-mail com este lead.") para a Tereza (Lavanderia Santa Tereza, `302147b0-…`), mesmo com mensagens enviadas.

## Causa
- As abas (`src/features/lead-channel-chat`) estão ligadas para a V4 (`app_flags.lead_channel_chat`, `allow_org_ids`).
- Com `lead_messages_capture` ligada (V4 desde 13/11), a leitura usava **só** `lead_messages` e não voltava para `interactions`.
- `lead_messages` não grava o WhatsApp do SDR (envio manual) nem respostas de WhatsApp, e não tem nada antes de 13/11.
- Números de 14/11 a 28/11: WhatsApp enviados 508, apareciam 56; respostas de WhatsApp 6, apareciam 0; e-mails enviados 814, apareciam 731.
- No caso da Tereza: o único e-mail **falhou** (25/11, nunca saiu) e os 2 WhatsApps (26/11 e 27/11, envio manual) não estavam em `lead_messages`.

## O que está no ar
| PR | O que faz | Commit |
|----|-----------|--------|
| #697 | Abas juntam `lead_messages` + `interactions` sem repetir | `a4e41af` (squash), confirmado em `/api/version` |

- `merge.ts` (novo): `alreadyStoredIds()` casa o registro da linha do tempo com a mensagem gravada pelo `external_id` = `provider_message_id`; se não casar assim, usa o horário (±2 min, mesmo sentido, pares mais próximos primeiro, cada um casa uma vez). `mergeStreams()` monta a página com as duas fontes e para no ponto mais novo em que alguma fonte ainda tem linhas, para não pular mensagem.
- Com a captura ligada, `opened`/`clicked`/`delivered` da linha do tempo viram só tique (não balão). `failed`/`bounced` continuam aparecendo.
- Se o casamento falhar, mostra só a conversa gravada (comportamento antigo).
- Conferido com dados reais (leitura rodada contra prod com service role): Tereza WA 2 msgs, e-mail 1 "Falhou"; Multylog WA 2 → 5 sem duplicar. Em toda a V4 passam a aparecer 452 WA, 6 respostas WA, 83 e-mails, 2 respostas de e-mail.
- Testes: `merge.test.ts` (novo) e `read.test.ts`. CI verde.

## Modelos de WhatsApp (alterados direto em prod, org V4)
`[Nome]` não é variável: o sistema só preenche `{{...}}`. 262 envios manuais desde 01/11 ficaram gravados com "[Nome]" (não dá para saber pelo banco se o lead recebeu assim: o envio manual grava o texto do modelo, não o que o SDR mandou).

| Antes | Depois | Modelos |
|---|---|---|
| `[Nome]` | `{{primeiro_nome}}` | 17 (Inbound v2 Dias 1–10, Recovery Dias 2–10) |
| `[Empresa]` | `{{empresa}}` | 4 (Inbound v2 Dia 1, Recovery Dias 2, 6, 10) |
| `[Nome do Lead]` | `{{primeiro_nome}}` | 2 (Recovery Dia 1 A/B) |
| `[Nome da Empresa]` | `{{empresa}}` | 2 (Recovery Dia 1 B, Dia 9) |

- Todos os leads ativos/pausados no Inbound 2.0 (62) e Recovery (211) têm primeiro nome e empresa.
- Ficaram de fora (o SDR preenche): `[Link do Case]`, `[Selecione um Case]`, `[Seu Nome]`.
- Scripts para desfazer: `docs/runbooks/2026-11-28-templates-*-VOLTAR.sql` — PR #699 MESCLADO (`aadfde8`, squash).

## Pendências
- **Ver a tela em produção:** a correção não foi vista no navegador (o login local no painel do app não funcionou). Abrir a Lavanderia Santa Tereza e conferir as duas abas.
- `lead_messages` continua sem gravar WhatsApp manual e respostas de WhatsApp. As abas agora compensam pela linha do tempo, mas a captura em si não foi mexida.

## Fora de escopo e intactos
- Cópia principal do repo na branch `feat/marcar-por-cima-closer-ocupado` (já mesclada no #681), com mudanças locais do Cockpit não tocadas. Nela ficaram os commits locais `b105e84c` e `24aba6a1` (mesmo conteúdo do #697 e #699).
- Worktrees no scratchpad: `wt-chat` (`fix/conversa-junta-linha-do-tempo`, mesclado) e `wt-runbooks` (`docs/runbooks-modelos-variaveis`, PR #699).
- Este handoff não foi commitado.
