# Story: WhatsApp automático pela Evolution, cadenciado por número do SDR

**Status:** InProgress
**Tipo:** Feature / WhatsApp / cadências
**Origem:** Vini (06/11/2026) — "Eu quero seguir com a Evolution porém encontrar uma forma de não bloquear os números dos pré-vendas de forma cadenciada para o segmento dele."
**Contexto:** tese de deixar o SDR só com a ligação e a IA/robô com e-mail e WhatsApp. O e-mail automático já existe (`auto_email`); o WhatsApp não.
**Épico relacionado:** nenhum ainda. Primeira peça da "cadência mista" (IA executa e-mail/WhatsApp, SDR liga).
**Estimativa:** L (6 a 8 dias úteis). Dois PRs: (1) migration + fila + limites + aquecimento + envio + freio; (2) menu Cockpit (visão SDR e gestor, Pausar/Retomar).

## Problema
1. O motor de cadência só envia **e-mail** sozinho. Passo de WhatsApp vira tarefa manual do SDR (`execute-cadence.ts`, "Only auto-execute email steps").
2. Quando o app envia pela Evolution (`WhatsAppEvolutionService.sendMessage`), a mensagem sai **na hora**: sem limite por dia, sem intervalo entre envios, sem "digitando…". O único limite (`whatsapp.service.ts`, 80/s) é o da API oficial da Meta e não vale para a Evolution.
3. Esse padrão (rajada, texto igual, sem pausa) é o que o WhatsApp usa para identificar robô e bloquear o número. Perder o número do SDR para a operação do dia e as conversas abertas.
4. Se o número do SDR não está conectado, o envio cai na instância padrão da organização — num envio em massa, isso concentraria todo o volume num número só.

## Valor
- O SDR para de gastar tempo copiando e colando mensagem de WhatsApp e fica com a ligação.
- O número do SDR fica protegido: o volume é espalhado ao longo do dia, com teto por número e freio automático.
- Primeiro passo concreto da tese "IA executa, SDR liga", sem trocar a Evolution pela API oficial.

## Decisões do Vini (06/11/2026)
- Continuar com a **Evolution** (não migrar para a API oficial da Meta agora).
- Cada SDR envia pelo **próprio número**, cadenciado para o segmento dele.

### Aprovadas pelo Vini em 06/11/2026 ("Aprovo todas")
1. **Limites**: número novo começa com 20 contatos novos/dia e sobe +10 a cada 3 dias úteis sem incidente, até 80/dia. Mensagens para quem já respondeu não contam no limite.
2. **Intervalo**: aleatório entre 2 e 6 minutos, só 8h–18h BRT em dias úteis (mesma janela do e-mail automático, respeitando feriados).
3. **Captura de resposta do WhatsApp** (`whatsapp_reply_capture_enabled`): será **ligada** antes do piloto, para que a cadência pare quando o lead responde. A virada da flag em produção é passo do deploy, não do código.
4. **Segmento**: usar o que já existe — `ai_personalization` do passo + `leads.segmento` no contexto da IA, com o template como base e fallback.
5. **Máximo de 3 mensagens sem resposta** por lead.
6. **Menu "Cockpit"** (`/cockpit`, novo item no `AppSidebar.tsx`), no PR 2: o **SDR** vê o próprio número (conectado, limite de hoje, enviados/na fila, pausado e por quê) e a fila do dia com Pausar/Retomar; o **gestor** vê os números de todo o time. Ficam para depois, no mesmo Cockpit: e-mails automáticos agendados, sinal de lead quente ("ligar agora") e respostas classificadas pela IA.

## Escopo
**IN**
- Opção "Enviar automaticamente" no passo de WhatsApp da cadência (nova coluna em `cadence_steps`, padrão desligado). Passos sem a opção continuam como hoje (tarefa manual).
- O motor de cadência, ao chegar num passo de WhatsApp automático, **não envia na hora**: coloca a mensagem numa **fila do número do SDR dono do lead** (`assigned_to`).
- Fila por número (nova tabela `whatsapp_send_queue`) com: limite diário por número, intervalo aleatório entre envios, janela de horário comercial e dias úteis.
- Aquecimento: limite diário cresce sozinho conforme a idade/histórico do número (colunas novas em `whatsapp_instances`: limite atual, início do aquecimento, motivo de pausa).
- Envio com "digitando…" antes da mensagem (presença `composing` / `delay` da Evolution).
- Texto renderizado na hora do envio (template + IA quando o passo tiver `ai_personalization`), para não sair igual para todos.
- **Sem fallback para o número da organização** no envio automático: se o número do SDR não estiver conectado, o item fica na fila e o SDR é avisado.
- Freio automático por número: pausa a fila do número e avisa SDR e gestor quando (a) a Evolution desconecta, (b) 3 envios seguidos falham, ou (c) a taxa de "número inválido / não é WhatsApp" do dia passa de 20%.
- Lead que responde no WhatsApp (com a captura ligada) tem os itens pendentes da fila cancelados.
- Item da fila que não sai no dia não "acumula" em rajada no dia seguinte: respeita o mesmo limite.
- Registro na timeline (`interactions`) igual ao envio manual, com o SDR como autor e a marca de envio automático.
- **Menu "Cockpit"** (`/cockpit`): visão do SDR (próprio número + fila do dia + Pausar/Retomar) e visão do gestor (todos os números do time).

**OUT**
- No Cockpit: e-mails automáticos agendados, sinal de lead quente e respostas classificadas (próximas stories).
- Migração para a API oficial da Meta.
- IA respondendo o lead no WhatsApp (conversa automática). Aqui só sai a mensagem da cadência; resposta continua com o SDR.
- Classificação da intenção da resposta (interessado / depois / sem interesse).
- Discador ordenado por "lead quente".
- Envio de mídia (áudio, imagem) automático — só texto.
- Troca automática para chip reserva.
- Cadência mista completa (executor por passo para todos os canais) — esta story cobre só o WhatsApp.

## Critérios de aceite
1. **Dado** um passo de WhatsApp com "Enviar automaticamente" ligado, **quando** o lead chega nesse passo, **então** um item entra na fila do número do SDR dono do lead e nenhuma mensagem sai na hora.
2. **Dado** um passo de WhatsApp sem a opção, **quando** o lead chega nele, **então** o comportamento é o de hoje (tarefa manual na fila de Atividades).
3. **Dado** um número com limite de 20/dia e 30 itens na fila para leads que ainda não responderam, **quando** o dia termina, **então** saíram no máximo 20 e os 10 restantes ficam para o próximo dia útil, sem ultrapassar o limite. Mensagens para leads que já responderam no WhatsApp não contam no limite.
4. **Dado** dois envios seguidos do mesmo número, **então** o intervalo entre eles está entre o mínimo e o máximo configurados, e nenhum envio acontece fora de 8h–18h BRT ou em fim de semana/feriado.
5. **Dado** o número do SDR desconectado, **quando** chega a vez de um item, **então** nada é enviado por outro número (nem o da organização), o item continua na fila e o SDR recebe aviso.
6. **Dado** 3 falhas seguidas de envio no mesmo número, **ou** a Evolution informando o número desconectado, **ou** mais de 20% dos envios do dia caindo em "número inválido / não é WhatsApp" (com pelo menos 5 envios no dia), **então** a fila daquele número pausa, o motivo fica gravado e SDR e gestor são avisados; retomar é manual.
7. **Dado** que o lead respondeu no WhatsApp (captura ligada), **então** os itens pendentes dele na fila são cancelados e a cadência segue a regra atual de resposta.
8. **Dado** um lead que já recebeu 3 mensagens de WhatsApp desde a última resposta dele (ou desde o início, se nunca respondeu), **então** novos itens de WhatsApp para ele são pulados e registrados como pulados.
9. **Dado** um número novo, **então** o limite diário começa em 20 e sobe +10 a cada 3 dias úteis sem incidente, até 80; um incidente (critério 6) volta o limite um degrau (−10, mínimo 20).
10. **Dado** um envio feito pela fila, **então** aparece na timeline do lead igual ao envio manual, com o SDR como autor e marcado como automático.
11. **Dado** o mesmo passo e o mesmo lead, **então** a fila nunca gera dois envios (proteção contra duplicidade igual à do e-mail: índice único por passo + lead).
12. **Dado** um SDR logado, **quando** abre o Cockpit, **então** vê só o próprio número: status (conectado ou não), limite de hoje, quantos foram enviados, quantos estão na fila e, se estiver pausado, o motivo; e consegue Pausar/Retomar a própria fila.
13. **Dado** um gestor logado, **quando** abre o Cockpit, **então** vê todos os números do time com os mesmos dados e pode Pausar/Retomar qualquer um.
14. **Dado** um SDR, **então** ele nunca vê nem altera o número de outro SDR (RLS + checagem na ação).
15. **Dado** um lead sem SDR responsável (`assigned_to` vazio) num passo de WhatsApp automático, **então** nenhum item entra na fila e o passo segue como tarefa manual (comportamento de hoje).
16. **Dado** um envio feito pela fila, **então** a chamada à Evolution leva o "digitando…" (presença/`delay`) antes da mensagem.

## Critério de pronto
Critérios 1–16 cobertos por testes (regra de limite/intervalo/janela como função pura com relógio falso); `pnpm typecheck`, `pnpm lint`, `pnpm test:run` e `pnpm build` verdes; migration aplicada e `pnpm gen:types` no mesmo PR; PR mesclado e deploy confirmado; piloto em produção com **1 SDR**, 1 cadência e limite inicial por 5 dias úteis sem bloqueio antes de abrir para o time.

## Dependências
- **Captura de resposta do WhatsApp ligada** (`whatsapp_reply_capture_enabled`) — aprovada pelo Vini em 06/11; ligar em produção antes do piloto. Sem ela, o critério 7 não funciona e a cadência continua mandando para quem já respondeu.
- Cada SDR do piloto com **número próprio conectado** em `whatsapp_instances` (`user_id` preenchido).
- Confirmar a versão da Evolution em produção e o formato do `delay`/presença no `sendText`.
- Migration: coluna em `cadence_steps`, colunas em `whatsapp_instances`, tabela `whatsapp_send_queue` (com RLS por org, trigger `set_updated_at` → `update_updated_at()`). Checkpoint 1 obrigatório.

## Riscos
- **Risco de bloqueio não zera.** A Evolution não é oficial; o WhatsApp pode mudar regras. Mitigação: limites conservadores, piloto com 1 SDR, freio automático, chip reserva aquecido (operacional, fora do sistema).
- **Outbound frio bloqueia mais que inbound.** Mitigação: começar o piloto por cadência de inbound.
- **Fila parada sem ninguém ver.** Mitigação: aviso ao SDR e ao gestor + entrar no alerta de robô parado (`health-check-workers`).
- **Cron rodando a cada minuto** para respeitar o intervalo: custo baixo, mas precisa de trava para não rodar duas vezes em paralelo.
- **Texto da IA fora do tom.** Mitigação: manter o template como base e a IA só personalizando (fallback para o template, como no e-mail).

## Validação @po (06/11/2026)
Checklist de 10 pontos: 1 título ✅ · 2 descrição ✅ · 3 critérios testáveis (Dado/Quando/Então) ✅ · 4 escopo IN/OUT ✅ · 5 dependências ✅ · 6 estimativa ✅ · 7 valor de negócio ✅ · 8 riscos ✅ · 9 critério de pronto ✅ · 10 alinhamento ⚠️ (sem PRD/épico; origem é pedido direto do Vini, primeira peça da tese "IA executa, SDR liga"). **Veredito: GO, 9/10.** Status Draft → Ready.

Ajustes feitos na validação:
- Critérios 3, 6, 8 e 9 passaram a trazer os números aprovados (limite que não conta quem já respondeu; os 3 gatilhos do freio, com mínimo de 5 envios para a regra dos 20%; contagem de "3 sem resposta" desde a última resposta; degraus do aquecimento).
- Critério 11: "mesma pessoa" → "mesmo lead".
- Critérios novos: 15 (lead sem SDR responsável segue como tarefa manual) e 16 ("digitando…" no envio).
- Estimativa revista para 6 a 8 dias, com o Cockpit no PR 2.

Observações para o @dev:
- (a) Regra de limite/intervalo/janela/aquecimento como função pura testada com relógio falso; o cron só chama a regra.
- (b) Trava contra duas execuções do cron em paralelo (ex.: `FOR UPDATE SKIP LOCKED` ao pegar o próximo item).
- (c) No envio automático, NÃO usar `resolveInstance` com fallback para a instância da organização; criar caminho que exige a instância do `user_id`.
- (d) Checkpoint 1 (pre-flight de migration) antes de escrever o SQL; `pnpm gen:types` no mesmo PR.
- (e) Ligar `whatsapp_reply_capture_enabled` é passo de lançamento, com aviso ao Vini — não faz parte do merge.
- (f) CodeRabbit não está habilitado no projeto: qualidade pelos gates de lint/typecheck/test/build.

## Dev Agent Record

### PR 1 — fila, limites, aquecimento, envio e freio (branch `feat/whatsapp-paced-sending`, worktree `EnriqueceAI_Pro-wa-paced`, 06/11/2026)
- [x] Checkpoint 1 (pre-flight): `update_updated_at`, `user_org_id`, `is_manager`, `advance_enrollment_after_step` e `uq_interactions_sent_step_lead_real` conferidos em prod; timestamp `20261106160000` acima do último de prod (`20261106145419`).
- [x] Migration: `cadence_steps.auto_send`; `whatsapp_instances.auto_send_*` (limite, aquecimento, próximo envio, falhas seguidas, pausa); tabela `whatsapp_send_queue` (RLS: gestor vê a org, SDR só a própria fila; escrita só service role; UNIQUE inscrição + passo); cron `process-whatsapp-queue` (`* 11-20 * * 1-5` UTC) clonando a autenticação do job `execute-cadence-steps` — nenhum segredo no repo.
- [x] Regra pura `whatsapp-auto-send/utils/pacing.ts` (janela 8h–18h BRT em dia útil, aquecimento 20 → +10/3 dias úteis → 80, degrau no incidente, intervalo 2–6 min, "digitando…" 3–8 s, freio por inválidos) — 23 testes com relógio fixo.
- [x] Enfileiramento (`enqueue.service.ts`): só cadências da fila humana, passo atual de WhatsApp automático **com template**, lead com dono e sem "Não é WhatsApp" — 4 testes.
- [x] Envio (`process-queue.service.ts`): reserva da vez do número por update condicional (trava contra rodadas paralelas), A/B + variáveis + IA com `segmento`, timeline como envio manual com `metadata.auto_send`, avanço pela RPC; cancela se a inscrição andou ou o lead respondeu; troca de dono passa o item para o número do novo SDR; 3 sem resposta pula o passo; destino sem WhatsApp marca `whatsapp_invalid_at`; freio (desconectado, 3 falhas seguidas, >20% inválidos com ≥5 tentativas, sem créditos) avisa SDR e gestores uma vez; item preso em "enviando" vira tarefa manual com aviso para conferir — 17 testes.
- [x] `EvolutionWhatsAppService.sendFromUserInstance`: só a instância do próprio SDR (sem fallback para a da org) + `delay` da Evolution v2; `sendMessage` reaproveita o mesmo POST sem mudar o comportamento — 4 testes.
- [x] Fila de Atividades esconde o passo automático; item `failed` volta como tarefa manual — 4 testes.
- [x] Opção "Enviar automaticamente" no diálogo do passo de WhatsApp (só com template); `saveTimelineSteps` preserva o valor salvo quando o campo não vem e força `false` fora de WhatsApp/sem template; `updateStepContent` valida — 2 testes.
- [x] Robô entra no `health-check-workers` (`process-whatsapp-queue`, só orgs com passo automático).
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test:run` (2864 passaram, 38 pulados) e `pnpm build` verdes.
- [x] Migration aplicada em produção em 06/11 (versões `20261106223900` e `20261106223931`; arquivos renomeados para casar com prod). Conferido: colunas, RLS, policy, trigger, cron `process-whatsapp-queue` ativo com URL e autenticação certas, 0 passos ligados.
- [x] `20261106223931`: `authenticated` só com SELECT na fila (o privilégio padrão do schema dava escrita e TRUNCATE, que ignora RLS).
- [x] `pnpm gen:types` rodado; typecheck verde. O arquivo também trouxe `sent_at` anulável (mudança de prod de outra branch, a do feedback adiado do closer).
- [x] PR 1 mesclado (#513, `9341981`) e no ar em 07/11 00:35 UTC; cron validado à mão (200, `enqueued 0`, rodada em `worker_run_state`).

### PR 2 — menu Cockpit (branch `feat/whatsapp-cockpit`, 07/11/2026)
- [x] `/cockpit` no menu (barra do topo → Prospecção, menu lateral, mobile e breadcrumbs) para todos os usuários.
- [x] `fetchCockpit`: SDR recebe só o próprio número e a própria fila; gestor recebe todos os números de SDR do time (critérios 12–13). A fila já é escopada pelo RLS; os números (RLS org-wide em `whatsapp_instances`) são filtrados no servidor (critério 14).
- [x] `buildCockpit` (puro): contatos novos de hoje × limite, enviadas, na fila, falhas do dia, pausa e motivo, próximo envio; fila do dia com pendentes primeiro — 8 testes.
- [x] `setAutoSendPaused`: pausar/retomar com checagem de posse (SDR só o próprio, gestor qualquer um da org, instância da organização nunca) e escrita pelo service role só nas colunas de pausa; não retoma com o WhatsApp desconectado; retomar zera falhas e intervalo — 6 testes.
- [x] Tela conferida no navegador com dados de exemplo (gestor com número conectado e pausado, SDR sem número). Página temporária sob `/docs/` apagada.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test:run` (2897 passaram) e `pnpm build` verdes.

### Decisões do dev
- Envio automático só com template escolhido: o campo "Mensagem / Instruções" do passo pode ser orientação para o SDR e não pode ir para o lead.
- Lead que troca de dono: o item vai para a fila do número do novo SDR (não cancela), para não esconder o passo de ninguém.
- Item que ficou em "enviando" (execução interrompida) não é reenviado — pode ter saído; vira tarefa manual com aviso.
- Notificação usa o tipo existente `integration_error` (sem mexer no enum `notification_type`).
- O contador do menu de Atividades (`fetchPendingActivitiesCount`) conta inscrições e pode incluir o passo automático vencido; diferença pequena, sem mudança nesta story.

## File List
- `supabase/migrations/20261106223900_whatsapp_paced_sending.sql` (novo)
- `supabase/migrations/20261106223931_whatsapp_send_queue_readonly_authenticated.sql` (novo)
- `src/lib/supabase/types.ts` (regenerado — commit separado `chore(types): regenerate`)
- `src/features/whatsapp-auto-send/utils/pacing.ts` + `.test.ts` (novos)
- `src/features/whatsapp-auto-send/utils/auto-step.ts` (novo)
- `src/features/whatsapp-auto-send/services/enqueue.service.ts` + `.test.ts` (novos)
- `src/features/whatsapp-auto-send/services/process-queue.service.ts` + `.test.ts` (novos)
- `src/features/whatsapp-auto-send/services/test-helpers.ts` (novo)
- `src/app/api/cron/process-whatsapp-queue/route.ts` (novo)
- `src/features/integrations/services/whatsapp-evolution.service.ts` + `.test.ts` (novo teste)
- `src/features/activities/actions/fetch-pending-activities.ts`
- `src/features/ai/types.ts`, `src/features/ai/utils/build-lead-context.ts`, `src/features/ai/prompts.ts`
- `src/features/cadences/types/index.ts`
- `src/features/cadences/actions/save-timeline-steps.ts` + `.test.ts`
- `src/features/cadences/actions/update-step-content.ts`
- `src/features/cadences/components/CadenceTimeline.tsx`, `CadenceBuilder.tsx`, `StepEditorDialog.tsx`
- `src/lib/workers/critical-workers.ts` + `.test.ts`
- PR 2: `src/app/(app)/cockpit/page.tsx`, `src/features/whatsapp-auto-send/actions/fetch-cockpit.ts`, `actions/set-auto-send-paused.ts` + `.test.ts`, `utils/cockpit-summary.ts` + `.test.ts`, `components/CockpitView.tsx`, `src/shared/components/TopBar.tsx` + `.test.tsx`, `AppSidebar.tsx`, `Breadcrumbs.tsx`

## Change Log
- 06/11/2026 — Story criada (Draft) a partir da conversa com o Vini sobre IA executando a cadência e o SDR só ligando.
- 06/11/2026 — Vini aprovou as 6 decisões; menu "Cockpit" entrou no escopo (critérios 12–14). Continua Draft até a validação do @po.
- 06/11/2026 — @po validou: GO 9/10, Draft → Ready. Critérios 3, 6, 8, 9 e 11 ajustados; critérios 15 e 16 adicionados; estimativa 6–8 dias.
- 06/11/2026 — @dev: PR 1 implementado (Ready → InProgress). Falta migration em prod + `gen:types` + PR 2 (Cockpit).
- 06/11/2026 — Migration aplicada em prod + leitura só para `authenticated` + `gen:types`.
- 07/11/2026 — PR 1 no ar (#513). PR 2 (Cockpit) implementado; critérios 1–16 cobertos. Falta: PR 2 mesclado + piloto em produção para Done.
