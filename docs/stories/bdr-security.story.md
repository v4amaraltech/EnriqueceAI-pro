# Story: Segurança do BDR IA — remetente forjado, agenda e dados de outra empresa

## Status
Done

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-04 | @dev (Dex) | Revisão adversarial (AJUSTAR) aplicada: (1) **injeção** de `dmarc=pass` pelo endereço de envio que o Gmail ecoa no comentário do SPF — agora comentários `( )` e aspas são removidos antes de ler, e o DMARC só vale se `header.from` for o domínio do From; (2) e-mail interno do mesmo Workspace (sem cabeçalho) aceito quando o domínio é o das caixas do BDR; (3) resposta que falha na verificação avisa o SDR dono (texto genérico, sem conteúdo) em vez de sumir; (4) **bug antigo** achado: `persistMeeting` gravava o id do USUÁRIO em `leads.closer_id` (FK → `closers`), o UPDATE falhava e o lead nunca recebia a reunião — agora mapeia usuário → closer pelo e-mail (sem par, grava sem closer) e checa o erro. |
| 2026-10-04 | @dev (Dex) | Implementado + testado. Alinhamento SPF/DKIM com o domínio do From acrescentado durante a implementação. |
| 2026-10-04 | Vini + Claude | Story criada a partir da auditoria de segurança de 04/out (achados 4, 6 e 14). Fechar antes de levar o BDR IA a outras empresas. |

## Origem

- **Caixa do BDR (ingestão):** o lead era casado pelo From com `ilike` **sem escapar** — um From `%@%.%` casava qualquer lead da org — e **sem checar autenticidade**. Um e-mail forjado marcava o lead como "respondeu", parava a cadência, abria conversa `ia_ativa` e entregava o texto do atacante ao agente de IA (injeção de prompt).
- **Solicitações de reunião:** busca por `execution_id` (sequencial no n8n) e por `lead_id` **sem filtrar a org**; `lead_id`, `closer_id` e `conversation_id` do corpo não eram validados — uma org com chave de API lia a solicitação de outra e os horários livres do closer dela.
- **Admissão:** `cadence_ids` de qualquer org entravam na conta.
- **Handoff:** `user_id` do corpo gravado sem validação (aceitava usuário de outra org).
- **Supressão:** e-mail comparado com `ilike` sem escapar (`_` casava outro endereço).

## Acceptance Criteria

1. Lead casado pelo From por igualdade case-insensitive (`escapeLikePattern`).
2. Autenticidade pelo cabeçalho `Authentication-Results` **do próprio Gmail** (o primeiro `mx.google.com`; os de baixo podem ser forjados): DMARC decide quando existe; sem DMARC, SPF ou DKIM aprovados **alinhados ao domínio do From** (mesmo domínio ou subdomínio).
3. Lead **novo** pelo From exige autenticação aprovada; com conversa já existente na thread, aceita aprovada ou sem cabeçalho; **reprovação explícita nunca** conta como lead. Mensagem recusada é gravada como `unknown` (sem conversa, sem agente) e logada.
4. `getOrCreateMeetingRequest` sempre filtra a org; a rota valida lead (da org, não deletado), closer (membro ativo da org) e conversa (da org e do lead) — 400 caso contrário.
5. Admissão usa só cadências da org.
6. Handoff aceita `user_id` só se for uuid de membro ativo da org (400 caso contrário); sem `user_id` segue como antes.
7. Supressão compara com o padrão escapado.
8. Comentários e textos entre aspas do `Authentication-Results` são ignorados; DMARC só conta para o `header.from` igual ao domínio do From.
9. E-mail do mesmo domínio das caixas do BDR sem cabeçalho de autenticação (interno ao Workspace) é aceito.
10. Resposta de lead reprovada na verificação gera aviso ao SDR dono (sem o conteúdo).
11. Reunião marcada pelo BDR grava no lead o closer correspondente da tabela `closers` (pelo e-mail do usuário), ou nenhum; erro do UPDATE é logado.

## Scope

**IN:** `ingest-email-inbox.ts`, `inbound-classifier.ts`, `gmail-inbox.service.ts`, `meeting-requests.ts` + rota, `admission.ts`, rota de ações de conversa, testes.

**OUT:** escopos por chave de API e `?token=` na URL (achado 9 — maior); webhook da API4COM com segredo global (achado 8); jobs `'use server'` sem guarda (achado 7).

## Riscos

- Resposta legítima de domínio sem DMARC e com SPF/DKIM desalinhados (raro em provedores reais — Gmail/Outlook assinam DKIM do próprio domínio) vira `unknown` e não chega ao agente. Fica no log (`[inbox] … sem autenticação`) e em `email_inbound.kind='unknown'`.

## Tasks

- [x] Escape + autenticidade alinhada na ingestão + testes
- [x] Agenda com org + validação de referências + testes
- [x] Admissão só com cadências da org + teste
- [x] Handoff com membro ativo + testes; supressão escapada
- [x] typecheck / lint / test:run / build
- [x] Revisão (ajustes aplicados)
- [x] PR

## File List

- `src/features/email-conversations/actions/ingest-email-inbox.ts` (modificado) · `ingest-email-inbox.test.ts` (novo)
- `src/features/email-conversations/services/inbound-classifier.ts` (modificado) · `inbound-classifier.test.ts` (modificado)
- `src/features/email-conversations/services/gmail-inbox.service.ts` (modificado)
- `src/features/bdr-agenda/actions/meeting-requests.ts` (modificado) · `meeting-requests.test.ts` (novo)
- `src/app/api/v1/meeting-requests/route.ts` (modificado)
- `src/features/bdr-admission/actions/admission.ts` (modificado) · `admission.test.ts` (novo)
- `src/app/api/v1/email-conversations/[id]/[action]/route.ts` (modificado) · `route.test.ts` (novo)
- `docs/stories/bdr-security.story.md` (novo)
