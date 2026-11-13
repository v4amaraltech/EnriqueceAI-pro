# Story: WhatsApp do Enriquece em Evolution Go dedicada + caixa de entrada única

**Status:** Ready (Fase 0 primeiro; Fases 1 e 2 só depois do veredito)
**Tipo:** Infra + integração / WhatsApp
**Origem:** Vini (13/11/2026). Começou com "no histórico de e-mail e WhatsApp só tem as mensagens que enviamos e não a do lead respondendo?" e terminou em três decisões: (1) caixa de entrada única do WhatsApp, (2) servidor de WhatsApp só do Enriquece, separado dos clientes, (3) trocar o motor para a **Evolution Go**, com teste antes.
**Épico relacionado:** nenhum. Continua `whatsapp-evolution-paced-sending` (PRs #513/#514) e a captura de conversa em `lead_messages` (PRs #571, #573, #574, #578, #579).
**Estimativa:** L, em 3 fases. Fase 0 (teste): 1 a 2 dias, sem PR de produto. Fase 1 (motor + servidor): M, 1 PR. Fase 2 (caixa única): M, 1 PR.

## Problema

### 1. A resposta do lead não aparece no histórico
- **E-mail:** o cron `check-email-replies` detecta a resposta (302 em 30 dias), mas a linha do tempo só mostra "Respondeu", sem texto. O texto vai para `lead_messages` pela `captureGmailReply`, e a flag `lead_messages_capture` foi **ligada para a V4 em 13/11/2026 09:56 UTC**. Isso resolve o e-mail, sem código.
- **WhatsApp:** nada chega em `lead_messages`. A rota `/api/webhooks/evolution/messages` está pronta, mas nenhuma instância envia para ela. Cada instância da Evolution aceita **um só** endereço de webhook, e hoje ele aponta para a Edge Function `evolution-webhook` (conexão, QR code e mensagens). Seguir o runbook `docs/runbooks/lead-messages-evolution-webhook.md` e trocar o endereço quebraria os avisos de conexão e QR code.

### 2. O WhatsApp está espalhado em pedaços que não conversam
| Pedaço | O que faz com a mensagem que chega | Como acha o lead |
|---|---|---|
| Edge `evolution-webhook` → `_shared/whatsapp-reply.ts` | marca `replied` e para a cadência (flag `whatsapp_reply_capture_enabled`, **desligada**) | RPC `find_lead_ids_by_phone` (leads) |
| Edge `evolution-webhook` → `_shared/consent-capture.ts` | consentimento (flag `consent_capture_v1`) | `leadPhoneMatches` (leads) |
| Rota `/api/webhooks/evolution/messages` | grava em `lead_messages` (flag `lead_messages_capture`) | RPC `match_lead_contacts_by_phone` (lead_contacts) |
| Rota `/api/webhooks/whatsapp` (Meta) | `lead_messages` + `replied` + consentimento | própria |

Três regras diferentes para achar o lead pelo telefone. Os bugs passados vieram daí: a resposta que nunca foi capturada até 04/10 e o telefone formatado que não casava.

### 3. O servidor da Evolution é dividido com clientes de fora do Enriquece
- O Enriquece usa a **chave global** da Evolution (`EVOLUTION_API_KEY`), que lê, desconecta e apaga **qualquer** número do servidor, inclusive os dos clientes. O que protege os clientes é só o filtro de nome `APP_INSTANCE_NAME_RE` (`ea_…`) no nosso código. Se a chave vazar do Enriquece, os WhatsApps dos clientes ficam expostos.
- Um travamento ou reinício causado por um cliente derruba o Enriquece, e o contrário também. O código já registra problemas desse servidor compartilhado: nomes presos como "already in use" e instâncias zumbis.
- Dados de clientes e do produto ficam no mesmo lugar, com a mesma chave (LGPD).

## Valor
- O SDR vê a conversa inteira do lead (o que enviamos e o que ele respondeu) dentro do Enriquece.
- Cada mensagem é processada uma vez, num lugar só e testável, com uma regra só para achar o lead.
- Os clientes ficam isolados do Enriquece, e cada número tem a sua própria senha.

## Decisões do Vini (13/11/2026)
- Fazer a caixa de entrada única do WhatsApp.
- Servidor de WhatsApp só do Enriquece, separado dos clientes.
- Trocar o motor para a **Evolution Go**, **com teste antes**. Se o teste reprovar, seguir com a Evolution API (Node/Baileys) num servidor dedicado.
- Ligar a pausa de cadência por resposta continua sendo decisão separada (flag `whatsapp_reply_capture_enabled`). Esta story não liga a flag.

## Uso atual da Evolution pelo Enriquece (levantado em 13/11/2026)
| Comando (Evolution API v2) | Onde |
|---|---|
| `/instance/create`, `/instance/connect`, `/instance/connectionState`, `/instance/fetchInstances`, `/instance/restart`, `/instance/logout`, `/instance/delete` | `supabase/functions/_shared/evolution.ts` (usado por `evolution-create-instance`, `evolution-cleanup`, `evolution-disconnect`, `evolution-webhook`) |
| `/message/sendText`, `/message/sendMedia` | `src/features/integrations/services/whatsapp-evolution.service.ts` |
| `/group/create`, `/group/updateParticipant`, `/group/updateGroupPicture` | `src/features/integrations/services/whatsapp-group.service.ts` (grupo da reunião, criado ao agendar em `schedule-meeting.ts`) |
| `/instance/fetchInstances` (saúde) | `src/app/api/cron/whatsapp-health/route.ts` |
| Leitura do payload de entrada | `supabase/functions/_shared/evolution-events.ts`, `src/features/lead-messages/evolution-parse.ts` |

Configuração: `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` no Coolify (app) e nos segredos das Edge Functions (Supabase). Instâncias da V4 em 13/11: 5 (3 `connected`, 2 `disconnected`).

## O que já se sabe da Evolution Go (pesquisa de 13/11, a confirmar no teste)
- Motor whatsmeow (Go). Licença Apache 2.0 com condições de marca.
- Comandos diferentes da Evolution API v2. Por exemplo, `/instance/qr` e `/instance/status`. Há `/message/sendText` e `/message/sendMedia`, mas não está confirmado que o corpo da requisição é igual.
- **Senha por instância** para o dia a dia. A chave global fica só para criar e administrar números.
- **Precisa de licença ativada, com aviso periódico ("heartbeat").** Sem ela, os endpoints respondem 503.
- Envia telemetria de uso.
- Webhook: a documentação só mostra um `WEBHOOK_URL` global e `webhookUrl`/`subscribe` no conectar. Não está claro se aceita cabeçalho com senha.
- Projeto novo: poucas versões e cerca de 70 problemas em aberto no GitHub.

## Escopo

### Fase 0 — Teste da Evolution Go (go/no-go)
**IN**
- Subir a Evolution Go num servidor ou container **só do Enriquece** (fora do servidor dos clientes), com chave global própria. Responsável: @devops com o Vini.
- Conectar **um número de teste**. Nenhum número de SDR entra nesta fase.
- Responder, por escrito, nesta story:
  1. **Licença:** o que acontece se o aviso periódico falhar (rede caída, servidor deles fora)? Por quanto tempo segue funcionando? Os envios param?
  2. **Webhook:** dá para configurar por instância? Aceita cabeçalho com senha? Quais eventos existem (mensagem recebida, mensagem enviada pelo celular, status, conexão, QR code)?
  3. **Payload:** exemplos reais (salvos sem dados pessoais) de mensagem recebida (texto, áudio, imagem), mensagem enviada pelo celular e mudança de conexão.
  4. **Envio:** texto e mídia funcionam com a senha da instância.
  5. **Grupos:** criar grupo, adicionar participante e trocar a foto (grupo da reunião).
  6. **Telemetria:** dá para desligar?
  7. **Estabilidade:** o número de teste fica conectado 48 h sem cair.
- Veredito GO/NO-GO do Vini, registrado nesta story.

**OUT**
- Qualquer mudança de código de produto.

### Fase 1 — Motor e servidor (1 PR)
Só depois do veredito da Fase 0.
- **GO:** vale o escopo abaixo inteiro.
- **NO-GO:** a fase vira só a migração para a Evolution API v2 num servidor dedicado (URL e chave novas, números reconectados, critérios 5 a 7). O adaptador único e a senha por instância (critérios 2 e 3) saem do escopo, a menos que o teste mostre que a Evolution API v2 também tem senha por instância.

**IN**
- Um adaptador único do motor de WhatsApp, usado pelas Edge Functions e pelo app, que cobre todos os comandos da tabela "Uso atual". A forma de compartilhar o adaptador entre Deno e Node fica a cargo do @architect.
- Senha por instância guardada criptografada no banco. A chave global só nas rotinas de criar e apagar.
- Ajustar `evolution-cleanup` e `evolution-create-instance` ao novo motor, mantendo o filtro `APP_INSTANCE_NAME_RE` mesmo com o servidor dedicado (defesa extra).
- Webhook de cada instância apontando para a `evolution-webhook`, com senha.
- Variáveis novas no Coolify e nos segredos do Supabase (Vini/@devops; quem preenche senhas é o Vini).
- Migração: reconectar os números da V4 pelo QR code e remover as instâncias `ea_…` do servidor antigo só depois de confirmar que todos estão no novo.

**OUT**
- Mudar a cadência de envio (`whatsapp-evolution-paced-sending`).
- API oficial da Meta.

### Fase 2 — Caixa de entrada única (1 PR)
**IN**
- A `evolution-webhook` continua sendo a **única porta**. Conexão e QR code seguem tratados nela.
- Mensagens (recebidas e enviadas pelo celular) vão para **um processador só**, que faz, nesta ordem e cada passo atrás da sua flag:
  1. grava a conversa em `lead_messages` (`lead_messages_capture`);
  2. consentimento (`consent_capture_v1`);
  3. resposta do lead: `replied` e parar a cadência (`whatsapp_reply_capture_enabled`, continua desligada).
- **Uma regra só** para achar o lead pelo telefone, usada pelos três passos. O @architect escolhe entre `match_lead_contacts_by_phone` (cobre vários contatos por lead) e `find_lead_ids_by_phone`.
- Se o processador ficar no app (Node), a Edge Function repassa a mensagem para a rota interna com senha. Se ficar na Edge Function, a leitura do payload não pode ficar duplicada. Decisão do @architect, registrada nesta story.
- A rota da Meta (`/api/webhooks/whatsapp`) passa a usar o mesmo processador ou fica documentada como fora, com o motivo.
- Remover o código duplicado que sobrar e atualizar `docs/runbooks/lead-messages-evolution-webhook.md`.

**OUT**
- Ligar `whatsapp_reply_capture_enabled`.
- Texto das respostas de e-mail antigas (já resolvido daqui para frente pela flag).
- Telefone formatado e resposta automática do WhatsApp Business contando como resposta (pendências conhecidas da captura de resposta). Viram story própria se continuarem depois da regra única.

## Critérios de aceite

**Fase 0**
1. **Dado** a Evolution Go no servidor dedicado, **quando** o teste termina, **então** as 7 perguntas da Fase 0 estão respondidas nesta story, com exemplos de payload sem dados pessoais e o veredito GO/NO-GO do Vini.

**Fase 1**
2. **Dado** um SDR conectando o número pelo Enriquece, **quando** lê o QR code, **então** a instância é criada no servidor dedicado e a linha em `whatsapp_instances` fica `connected` com o telefone. _(só se GO)_ A senha da instância é gravada criptografada.
3. _(só se GO)_ **Dado** um envio de cadência (texto e mídia), **quando** o motor envia, **então** usa a senha da instância e não a chave global.
4. **Dado** uma reunião agendada, **quando** o grupo da reunião é criado, **então** os participantes e a foto ficam iguais ao fluxo de hoje.
5. **Dado** um número desconectado no celular, **quando** chega o aviso de conexão, **então** a instância fica `disconnected` e o alerta de saúde segue funcionando.
6. Nenhuma instância fora do padrão `ea_…` é listada, alterada ou apagada pelo Enriquece (teste que falha se for).
7. Depois da migração, nenhuma instância `ea_…` da V4 fica no servidor antigo.

**Fase 2**
8. **Dado** o lead responder no WhatsApp com `lead_messages_capture` ligada, **quando** a mensagem chega, **então** aparece na conversa do lead em até 1 minuto, com texto (ou mídia) e hora.
9. **Dado** o SDR responder pelo celular, **então** a mensagem aparece como enviada na mesma conversa.
10. **Dado** um telefone salvo formatado, como "(11) 99999-8888", **quando** o lead escreve, **então** é casado com o lead, pela mesma regra nos três passos.
11. **Dado** `whatsapp_reply_capture_enabled` desligada, **então** nenhuma cadência é pausada nem marcada `replied` por mensagem de WhatsApp.
12. **Dado** a mesma mensagem reenviada pela Evolution, **então** não duplica em `lead_messages` nem em `interactions`.
13. **Dado** uma falha ao gravar, **então** a resposta é 5xx para a Evolution reenviar (comportamento atual mantido).
14. Conexão e QR code continuam funcionando sem mudança de endereço de webhook.

## Critério de pronto
- Fase 0 com veredito registrado.
- Critérios 2 a 14 cobertos por testes. `pnpm typecheck`, `pnpm lint`, `pnpm test:run` e `pnpm build` verdes.
- PRs mesclados, deploy conferido em `/api/version` e Edge Functions publicadas à mão (não saem no merge).
- Em produção: os números da V4 conectados no servidor novo, uma conversa real com resposta do lead visível no histórico, e o grupo de uma reunião real criado.

## Dependências
- **Operacional:** servidor ou container novo, licença da Evolution Go e as senhas no Coolify e no Supabase (Vini/@devops).
- **SDRs:** reconectar o número pelo QR code na migração (combinar horário fora do envio de cadência, que vai das 8h às 18h).
- **Interna:** `lead_messages` e a janela `lead_channel_chat` já no ar. Flag `lead_messages_capture` ligada para a V4 em 13/11/2026.

## Riscos
- **Licença com aviso periódico:** se falhar, o WhatsApp do Enriquece para. É o principal ponto do go/no-go.
- **Projeto novo:** bugs e mudanças de API. Mitigação: adaptador único, para trocar de motor sem mexer no resto.
- **Bloqueio de número:** igual ao de hoje (as duas soluções são não oficiais). **Aconteceu no teste de 13/11** (24 h, número de teste): aparelho novo, QRs vencidos e criação de grupos em sequência. Mitigação: carência após conectar, QR renovado antes de vencer e migração escalonada.
- **Janela de migração:** mensagens que chegarem durante a troca podem não ser capturadas. Mitigação: migrar fora do horário de envio.
- **Ligar a gravação muda o volume de escrita** em `lead_messages` (todas as mensagens de cada número, não só as de leads). As mensagens sem lead vão para `lead_message_unmatched`, então é preciso acompanhar o crescimento dessa tabela.

## Resultado da Fase 0 (13/11/2026, parcial — veredito após 48 h)
Ambiente: Evolution Go em `evolution.v4companyamaral.com` (servidor só do Enriquece, chave própria). Instância de teste `enriquece-fase0` (id `45f8f355-…`), conectada às 11h BRT de 13/11. Eventos capturados pelo WebSocket da própria Evolution Go (`/ws`), sem passar por serviço de terceiros. Uma instância antiga, "Kaique", existe no servidor (desconectada, webhook para o n8n) e não foi tocada.

| # | Pergunta | Resultado |
|---|---|---|
| 1 | Licença | ✅ `/license/status` = `active`. ⚠️ Não foi possível simular a falha do aviso periódico (servidor da licença fora do ar). Fica como risco aberto. |
| 2 | Webhook | ✅ Por instância: `webhookUrl` + `subscribe` (lista de eventos ou `ALL`) no `POST /instance/connect`. ⚠️ Não há cabeçalho com senha. **Todo evento traz `instanceToken`**: o receptor confere esse campo contra a senha guardada da instância. A entrega real por webhook (tentativas e repetição) será conferida na Fase 1 com o endpoint de verdade. |
| 3 | Formato | ✅ Texto, áudio (`audioMessage`, `ptt`, segundos) e imagem com legenda chegam completos. Evento `Message`, com `data.Info` (`Chat`, `Sender`, `SenderAlt`, `RecipientAlt`, `IsFromMe`, `IsGroup`, `Type`, `MediaType`, `ID`, `Timestamp`, `PushName`) e `data.Message` (formato whatsmeow). Ver as regras abaixo. |
| 4 | Envio | ✅ `POST /send/text` (`number`, `text`) e `POST /send/media` (`number`, `type`, `url`, `caption`) com a senha da instância no cabeçalho `apikey`. **A chave global é recusada no envio (401)**. A mídia por URL precisa responder com `Content-Type` de imagem (URL com redirecionamento falhou). |
| 5 | Grupos | ✅ `POST /group/create` (`groupName`, `participants` como `<número>@s.whatsapp.net`) já adiciona as pessoas. Com o número sem sufixo, a chamada não respondeu em 60 s. ✅ `POST /group/photo` com `image` = `data:image/jpeg;base64,…` (PNG é recusado). ❌ `POST /group/participant` responde "participants is required" mesmo com a lista preenchida (testado com e sem sufixo): defeito da Evolution Go. Não bloqueia, porque o Enriquece só usa esse comando como reserva para adicionar quem não entrou ao criar. ✅ `POST /group/leave`. |
| 6 | Telemetria | ❓ Não visível pela API. O Vini confere nas variáveis do servidor se existe opção para desligar. |
| 7 | 48 h conectado | ❌ **Invalidado.** Por volta de 12h BRT de 13/11 o número de teste levou **bloqueio temporário de 24 h do WhatsApp**. No mesmo horário, o servidor passou a responder 404 em todos os endereços (causa a apurar). Refazer com um número aquecido (ver abaixo). |

**Regras para a implementação (vindas do teste):**
- **Telefone do contato:** mensagem recebida traz o telefone em `Info.Chat`/`Info.Sender` (`@s.whatsapp.net`) e o LID em `SenderAlt`. Mensagem enviada pelo celular (`IsFromMe`) traz `Chat` como `@lid` e o telefone em `Info.RecipientAlt`. Regra: usar o campo que termina em `@s.whatsapp.net`, nunca o `@lid`.
- **Grupos:** ignorar `IsGroup = true` (ou ligar `ignoreGroups` na instância).
- **Mídia:** chega embutida em base64 dentro do evento. Salvar o arquivo no storage e não guardar o evento inteiro.
- **Mensagens sem conteúdo útil:** chegaram `templateMessage` vazio e `Message` vazio. O processador ignora sem dar erro.
- **Eventos de conexão:** `QRCode`, `QRTimeout` (após 5 QR vencidos, a instância desloga sozinha), `PairSuccess`, `LoggedOut`. A tela de conexão precisa renovar o QR sem o SDR ver um QR vencido.
- **Comandos (troca da Evolution API v2 → Go):** `connectionState` → `GET /instance/status` (`Connected`, `LoggedIn`); `connect` → `POST /instance/connect` + `GET /instance/qr`; `fetchInstances` → `GET /instance/all` (chave global); `delete` → `DELETE /instance/delete/{id}`; `logout` → `DELETE /instance/logout`; `restart` → `POST /instance/reconnect`; `sendText`/`sendMedia` → `/send/text`/`/send/media`; `group/create`, `updateParticipant`, `updateGroupPicture` → `/group/create`, `/group/participant`, `/group/photo`. Testados no teste: `status`, `connect`, `qr`, `all`, `send/text`, `send/media` e os de grupo. A partir da documentação (Swagger do servidor), a confirmar na Fase 1: `delete`, `logout` e `reconnect`.

**Bloqueio do número de teste (13/11):** em menos de 1 hora, o aparelho recém-conectado passou por 5 QR vencidos e reconexões, recebeu o histórico (`HistorySync`), enviou mensagens pela API e **criou 2 grupos seguidos** com o mesmo contato, saindo em seguida. O mais provável é que o bloqueio venha desse padrão de uso, e não do motor em si: o risco é o mesmo na Evolution API, porque as duas são não oficiais. Mas ele vale para a migração, já que cada SDR que reconectar pelo QR vira um "aparelho novo" para o WhatsApp.

**Novas regras (Fases 1 e 2):**
- Número recém-conectado não cria grupo nem envia em volume nas primeiras horas. O envio cadenciado (`whatsapp-evolution-paced-sending`) e a criação do grupo da reunião precisam respeitar uma carência após a conexão. O tamanho dessa carência é decisão do Vini.
- A tela de conexão renova o QR antes de vencer, para não acumular QRs vencidos (a instância desloga sozinha após 5).
- A migração dos números da V4 é escalonada (não todos no mesmo dia) e fora do horário de envio.

**Refazer o item 7:** usar um número **já aquecido** (uso normal há semanas), só conectado e recebendo mensagens, sem grupos e sem envios em sequência, por 48 h. Anotar também se o número bloqueado volta sozinho depois das 24 h.

**Leitura parcial:** continua **GO** nos itens 1 a 5. O veredito final depende do item 7 refeito e da causa do 404 no servidor.

## Validação @po (13/11/2026)
Checklist de 10 pontos:
1. Título claro ✅
2. Descrição do problema ✅ (3 problemas com dados de 13/11)
3. Critérios testáveis (Dado/Quando/Então) ✅
4. Escopo IN/OUT por fase ✅
5. Dependências ✅
6. Estimativa ✅
7. Valor de negócio ✅
8. Riscos ✅
9. Critério de pronto ✅
10. Alinhamento ⚠️ (sem PRD nem épico; a origem é pedido direto do Vini, continuação da `whatsapp-evolution-paced-sending` e dos PRs de `lead_messages`)

**Veredito: GO, 9/10.** Status Draft → Ready.

Ajustes feitos na validação:
- (a) A Fase 1 dizia "sem adaptador novo" no caminho NO-GO, mas exigia adaptador e senha por instância. Agora o escopo de cada veredito está separado, e os critérios 2 e 3 marcam o que vale só com GO.

Observações para o @dev e o @architect:
- (b) A Fase 0 não tem código de produto. O @dev só começa a Fase 1 com o veredito registrado aqui.
- (c) As decisões abertas (onde fica o processador, qual regra de telefone, como compartilhar o adaptador entre Deno e Node) precisam ser registradas nesta story pelo @architect antes da Fase 2.
- (d) Corrigir o runbook `docs/runbooks/lead-messages-evolution-webhook.md` já na Fase 1, para ninguém trocar o webhook antes da hora.
- (e) CodeRabbit não está habilitado no projeto; a qualidade é garantida por lint, typecheck, testes e build.

## Dev Agent Record
_Pendente._

## File List
_Pendente._

## Change Log
- 13/11/2026: Story criada (Draft) a partir da conversa com o Vini. Flag `lead_messages_capture` ligada para a V4 no mesmo dia (texto das respostas de e-mail).
- 13/11/2026: Validação @po — GO 9/10, Draft → Ready. Escopo da Fase 1 separado por veredito (GO/NO-GO).
- 13/11/2026: Resultado parcial da Fase 0 registrado (itens 1–6; item 7 em andamento). Leitura parcial: GO.
- 13/11/2026: Número de teste bloqueado por 24 h pelo WhatsApp; item 7 invalidado; servidor da Evolution Go respondendo 404. Risco de bloqueio na migração e novas regras (carência após conectar, QR renovado, migração escalonada) registrados.
