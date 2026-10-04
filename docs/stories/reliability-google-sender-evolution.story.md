# Story: Confiabilidade — erros do Google, inscrição sem remetente e webhook do WhatsApp

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-04 | @dev (Dex) | **Edge Function `evolution-webhook` publicada (v41)** a pedido do Vini. Captura atrás da chave `app_flags.whatsapp_reply_capture_enabled`, criada **desligada**. Conferido em prod: ids novos (`…_<key.id>_<status>`), todas as respostas 200; 23505 de entrega dupla da Evolution silenciado. |
| 2026-10-04 | @dev (Dex) | Revisão adversarial (AJUSTAR): **2º bug que mantinha tudo quebrado** — busca da inscrição ordenava por `cadence_enrollments.created_at` (não existe; é `enrolled_at`), erro não checado → sempre "sem inscrição". Corrigido + teste de `captureInboundReply`. Também: chave liga/desliga (decisão de produto antes de ligar), ignora reação/apagada/edição/enquete, lead antes do duplicado (sem varrer `interactions`), 400 para JSON inválido. |
| 2026-10-04 | @dev (Dex) | Implementado + testado. Achado durante a implementação: a captura de resposta pelo WhatsApp **nunca funcionou** (org errada). |
| 2026-10-04 | Vini + Claude | Story criada a partir da auditoria de 04/out (agente de confiabilidade, achados 3, 5 e 11). Vini escolheu "Erros do Google e remetente" + "Webhook do WhatsApp". |

## Origem

Auditoria de 04/10/2026, conferida em produção:

1. **Erro passageiro do Google pausava a cadência.** `refreshAccessToken` tratava qualquer falha ao renovar o token (500/429/rede) como "reconexão necessária", marcava a conexão `error`, e o motor — que considera essa frase permanente — pausava a inscrição na hora. Em 14/09, **9 inscrições** pausadas assim enquanto a mesma caixa enviou **~90 e-mails** nas 2 horas seguintes.
2. **Inscrição sem remetente falhava para sempre.** SDR sem Gmail + cadência sem criador: registrava falha e tentava de novo a cada 5 min, indefinidamente. O lote do motor não tinha ordem, então casos travados podiam ocupar as 25 vagas.
3. **Webhook do WhatsApp (Evolution):**
   - **(achado novo, crítico)** usava `instance.organization_id`, mas a coluna é `whatsapp_instances.org_id` → a busca do lead saía com `org_id=undefined` e **nenhuma resposta de WhatsApp foi registrada pelo webhook desde que ele existe** (PR #149). Em 7 dias: 15.696 eventos de mensagem, 0 respostas; logs com `org=undefined`.
   - marcava o evento como processado **antes** de processar e respondia **200 mesmo em erro** → mensagem perdida sem alerta.
   - id de idempotência `instância_evento_date_time` → duas mensagens no mesmo milissegundo colidiam e a segunda era descartada como duplicada.

## Acceptance Criteria

1. Só `invalid_grant` na renovação do token marca a conexão Gmail como `error` e devolve "reconexão necessária". 5xx/429/rede/timeout devolvem erro passageiro (cai na regra de 3 tentativas do motor) sem mexer na conexão.
2. Inscrição sem remetente é **pausada** com evento na timeline e notificação ao dono explicando que falta Gmail conectado.
3. O lote do motor pega primeiro os vencidos há mais tempo (`next_step_due` asc).
4. O webhook usa `whatsapp_instances.org_id` para achar o lead.
5. Mensagens usam o id do WhatsApp (`key.id`, + status em `messages.update`) como chave de idempotência; reenvio da mesma mensagem é deduplicado.
6. O evento só é gravado em `provider_events` depois de processado; erro de processamento devolve **5xx** e não grava o evento.
7. Erro de consulta/insert em `captureInboundReply` sobe como erro (não vira "lead não encontrado" / "sem inscrição").
8. A busca da inscrição ordena por `enrolled_at`.
9. Captura só roda com `app_flags.whatsapp_reply_capture_enabled = true` (sem linha = desligado).
10. Reação, mensagem apagada/editada e voto em enquete não contam como resposta.

## Scope

**IN:** `email.service.ts` (`refreshAccessToken`), `execute-cadence.ts` (no_sender, aviso, ordem do lote), Edge Function `evolution-webhook` + `_shared/whatsapp-reply.ts` + novo `_shared/evolution-events.ts` (funções puras), testes.

**OUT:** telefone formatado não achado na resposta de WhatsApp (28% dos leads) e contatos extras; alertas de robô parado; idempotência dos webhooks API4COM/Stripe; e-mail marcado como enviado antes de sair; reativar as 9 inscrições pausadas em 14/09 (decisão à parte).

## Riscos

- **Ao LIGAR a chave, respostas de WhatsApp passam a parar cadências e notificar SDRs pela primeira vez.** Estimativa da revisão (01/10): 308 mensagens recebidas de 51 telefones; ~16 leads com inscrição ativa → **~10–16 leads/dia útil** saem da fila de atividades (viram `replied`). Para **todas** as inscrições ativas do lead, inclusive BDR IA. Avisar o time antes de ligar.
- Resposta automática do WhatsApp Business do lead ainda conta como resposta (sem heurística).
- Telefone formatado (28% dos leads) continua sem casar — fora do escopo.
- Respostas a 5xx: se a Evolution reenviar em loop num erro permanente, gera repetição de log (o reenvio é idempotente pelo id da mensagem).
- Edge Function não é publicada pelo merge — precisa de deploy (`supabase functions deploy evolution-webhook` ou MCP).

## Tasks

- [x] `refreshAccessToken`: `invalid_grant` × passageiro + timeout + testes
- [x] no_sender: pausa + aviso próprio; lote ordenado
- [x] Webhook: org_id, id de idempotência, gravar após processar, 5xx em erro
- [x] Funções puras em `_shared/evolution-events.ts` + testes (Vitest)
- [x] typecheck / lint / test:run / build
- [x] Revisão (ajustes aplicados)
- [x] Deploy da Edge Function (v41) + conferir tráfego (200, ids novos)
- [ ] Decidir e ligar `whatsapp_reply_capture_enabled` + conferir primeira resposta registrada
- [x] PR

## File List

- `src/features/integrations/services/email.service.ts` (modificado)
- `src/features/integrations/services/email.service.refresh.test.ts` (novo)
- `src/features/cadences/actions/execute-cadence.ts` (modificado)
- `supabase/functions/evolution-webhook/index.ts` (modificado)
- `supabase/functions/_shared/whatsapp-reply.ts` (modificado)
- `supabase/functions/_shared/evolution-events.ts` (novo)
- `tests/edge/evolution-events.test.ts` (novo)
- `tests/edge/whatsapp-reply.test.ts` (novo)
- `supabase/functions/_shared/supabase.ts` (23505 de entrega dupla não loga erro)
- `tsconfig.json` (`tests/edge` fora do tsc — testa código Deno; roda no Vitest)
- `docs/stories/reliability-google-sender-evolution.story.md` (novo)
