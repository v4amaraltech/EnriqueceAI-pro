# Story: Webphone embutido da API4COM (ligar sem extensão)

**Status:** InProgress
**Tipo:** Feature / integração de telefonia
**Origem:** Vini (21/10/2026) — o CRM da matriz integrou a API4COM com um token único da conta pai e liga direto da página, sem a extensão do Chrome aberta e sem precisar desligar na extensão.
**Épico relacionado:** nenhum. Substitui a dependência operacional da extensão descrita em `6.1.auto-register-external-calls`.
**Estimativa:** L (8 a 10 dias úteis). Bloco 1: 2 dias. Bloco 2: 4 a 5 dias, inclui o protótipo isolado. Bloco 3: 2 dias. Validação em produção: 1 dia.
**Entrega:** 3 PRs, um por bloco, nesta ordem. O bloco 1 tem valor sozinho (migra o `/dialer` descontinuado e tira o token por SDR) e pode ir ao ar antes dos outros.

## Dependências
- **Externa, já resolvida:** documentação da API4COM e sondagem de leitura do passo 0 (abaixo).
- **Externa, pendente, não bloqueia o bloco 1:** a matriz apontar o CRM dela para os ramais antigos (decisão de 21/10). Enquanto não acontecer, ligações da matriz nos ramais 1047–1054 não aparecem no EnriqueceAI.
- **Interna:** o bloco 2 depende do bloco 1 (senha SIP e domínio preenchidos pelo sync). O bloco 3 depende do bloco 2.
- **Operacional:** no dia de ligar o bloco 2 para um SDR, a extensão do Chrome dele precisa estar fechada.
- **Ambiente:** `TOKEN_ENCRYPTION_KEY` existe só no Coolify. Testes locais do sync precisam de uma chave local e de um token de teste; não copiar a chave de produção.

## Problema
Hoje o SDR só consegue ligar pelo EnriqueceAI com a extensão API4COM (webphone) aberta no navegador:

1. O app chama `POST /dialer` na API4COM com o token **do próprio SDR** e o ramal dele (`src/features/integrations/services/api4com.service.ts`).
2. A API4COM faz o ramal tocar. Quem atende esse ramal é a extensão. O app não controla o áudio nem o desligar.
3. O app só descobre que a ligação acabou pelo webhook (via n8n), observado por Realtime na linha de `calls` (`use-call-hangup-detection.ts`).

Consequências: cada SDR precisa gerar e cadastrar o próprio token; se a extensão não está aberta a ligação "some"; o desligar tem que ser feito na extensão; e o app não sabe nada sobre a qualidade do áudio.

## Referência (CRM da matriz)
Comportamento observado nas telas enviadas pelo Vini em 21/10/2026:

- Botão "Ligação" abre um seletor de contato → "Iniciar ligação" → painel com nome, número, cronômetro, **Desligar**, **Mutar** e campo de anotações.
- O painel é **flutuante e arrastável** pela tela (picture-in-picture), e continua visível enquanto o SDR navega.
- Ao desligar, o painel vira "Ligação finalizada" com o tempo, anotações e botão "Concluir".
- Depois aparece "Como estava a qualidade do áudio?" com 5 estrelas (opcional). Isso indica áudio por **WebRTC dentro da página**.
- A integração pediu apenas o **token que não expira da conta pai** e os **e-mails dos usuários da conta pai**; nenhum token, ramal ou senha por SDR. Ou seja: o CRM descobre os ramais pela API da API4COM e liga cada usuário do CRM ao usuário da API4COM pelo e-mail.

## Histórico: já foi tentado e removido
- **25/03/2026, commit `0755fc39`** — "add API4COM native webphone (SIP/WebRTC) foundation": widget flutuante, hooks `useApi4ComWebphone` + `useLibWebphoneLoader`, registro SIP em `wss://{sip_domain}:6443` com `sip:{ramal}@{sip_domain}` + senha do ramal, auto-atendimento das ligações iniciadas pela API via cabeçalho `X-Api4comintegratedcall`. Migration `20260324210000` criou `sip_domain` e `sip_password_encrypted`.
- **11/06/2026, PR #23 (`aeba9ccc`)** — desligado do layout: o `libwebphone.js` do CDN da API4COM (`https://api.api4com.com/static/libwebphone.js`) é um bundle CommonJS transpilado que exige `babel-runtime`; o loader fazia `window.require = () => ({})` e a lib quebrava em toda página autenticada (`(0, _typeof3.default) is not a function`, React #185).
- **12/06/2026, PR #25 (`e0e26a5a`)** — arquivos apagados. Ficaram restos:
  - colunas `sip_domain` / `sip_password_encrypted` em `api4com_connections`;
  - seção "Webphone SIP (Opcional)" no `Api4ComConfigModal.tsx`;
  - action `getApi4ComSipCredentials` (`src/features/calls/actions/get-api4com-sip-credentials.ts`), **sem callers**, que devolve senha SIP e token descriptografados ao navegador;
  - `window.dispatchEvent(new CustomEvent('webphone:call-context', …))` em `ActivityPhonePanel.tsx` sem ninguém ouvindo.

Lição: a causa da remoção foi **empacotamento da biblioteca**, não o conceito. O conceito (SIP sobre WebSocket + auto-atendimento) é o mesmo que a matriz usa.

## Objetivo
O SDR clica em "Ligar" e fala com o lead **pela própria página do EnriqueceAI**, sem extensão, com desligar, mudo, anotações e avaliação de áudio no mesmo painel flutuante. A organização configura **um** token da API4COM; o ramal de cada SDR é descoberto pela API e casado pelo e-mail do usuário. O SDR não configura nada.

## Como a API4COM documenta isso (pesquisa 21/10/2026)
Fonte: guia oficial "Integração utilizando Webphone próprio" e referência da API v1.55.6 em `developers.api4com.com`. Resolve as dúvidas que estavam abertas:

| Dúvida | Resposta documentada |
|---|---|
| Token único | `POST /users/accessTokens` com `ttl: -1` cria um token que **nunca expira**. Vai no cabeçalho `Authorization` **sem** `Bearer` (como já fazemos). É o "token da conta pai" que o integrador pediu. |
| Ramais por e-mail | `GET /extensions` (token da conta) devolve, para cada ramal: `id`, `domain`, `ramal`, **`senha`** (senha SIP), `bina`, `first_name`, `last_name`, **`email_address`**, `gravar_audio`. Aceita `filter` LoopBack por e-mail. É por isso que a matriz só precisou de token + e-mails: casa `email_address` com o e-mail do usuário do CRM. `GET /extensions/{id}` devolve o mesmo objeto. |
| Originar chamada | `POST /calls` com `{ extension, caller, called, metadata }` (`caller` = `extension`; `called` em E.164 `+55…`). Resposta `{ status, id, message }`. **`POST /dialer` está descontinuado** e deve ser migrado. O `id` do `/calls` é o **mesmo id da lista de chamadas e do webhook** (o do `/dialer` não era; é a razão de existir o worker `back-associate`). A resposta só volta depois que o ramal atende, então o timeout HTTP precisa cobrir o toque. Limite: 15 chamadas/min por ramal. |
| Desligar | `POST /calls/{id}/hangup` (30/min por usuário). Ids do `/dialer` são rejeitados. |
| Áudio no navegador | SIP sobre WebSocket em **`wss://{domain}:6443`**, `username` = ramal, `password` = `senha` do ramal, `realm` = domínio da conta. Uma instância por usuário (singleton): nova instância derruba a anterior. Chamada que chega com cabeçalho **`X-Api4comintegratedcall: true`** foi originada pela API e deve ser **atendida automaticamente**. |
| Biblioteca | A API4COM distribui o `libwebphone.js` (Kazoo Webphone v2.0, do 2600hz), que por dentro é **JsSIP 3.9.1**. Não existe no npm; só build do fonte ou o bundle do CDN (CommonJS com `babel-runtime`, o que quebrou em junho). |
| Webhook | `PATCH /integrations` com `gateway`, `webhook: true`, `webhookConstraint.metadata.gateway`, `metadata.webhookUrl/webhookVersion/webhookTypes`. Igual ao que já temos em `registerCallWebhook`. |

Referência de terceiros que fez a mesma coisa: PR `time-yide/yide-acompanha#983` usa **JsSIP** direto, registra o webphone no login, auto-atende pelo mesmo cabeçalho e dispara por `POST /calls`.

Fica em aberto só o que não está na documentação:
- Se o token da conta pai origina chamada para qualquer ramal da conta. O CRM da matriz faz isso com um token só, então na prática sim; confirmar no primeiro teste.
- Como a matriz calcula a avaliação de áudio (só pergunta ao SDR, ou mede `getStats()`).

## Decisão de abordagem
**Recomendada: JsSIP direto** (`jssip` 3.13.9 no npm, com tipos). Motivos: o `libwebphone` é só uma casca sobre o JsSIP e não existe no npm; o bundle do CDN foi o que quebrou em junho; o JsSIP entra no bundle do Next normalmente, sem `window.require`. Alternativas mantidas só como registro:
1. `libwebphone` buildado do fonte e vendorizado. Mais código de terceiro para manter, sem ganho.
2. Iframe do webphone da API4COM. Sem controle do painel, do desligar nem da avaliação.

Configuração do JsSIP (equivalente ao exemplo oficial da API4COM):
```ts
const socket = new JsSIP.WebSocketInterface(`wss://${domain}:6443`);
const ua = new JsSIP.UA({
  sockets: [socket],
  uri: `sip:${ramal}@${domain}`,
  password: senha,
  realm: domain,
  register: true,
  register_expires: 600,
  no_answer_timeout: 30,
  user_agent: 'enriqueceai-webphone',
  session_timers: false,
});
ua.on('newRTCSession', ({ session }) => {
  if (session.direction !== 'incoming') return;
  const integrated = session.request.getHeader('X-Api4comintegratedcall') === 'true';
  if (integrated) session.answer({ mediaConstraints: { audio: true, video: false } });
});
```

A ligação continua sendo **originada pelo servidor**, agora por `POST /calls` (migração obrigatória do `/dialer`), e o navegador **atende sozinho** a perna do ramal. Isso preserva o `api4com_call_id` em `calls.metadata` e melhora o casamento do webhook, porque o id do `/calls` é o mesmo do evento. Discar por INVITE direto do navegador fica fora de escopo.

## Escopo

### Bloco 1 — Token único da conta pai + descoberta de ramais por e-mail
- Novo lugar para o token no nível da organização (opção A: tabela `api4com_org_settings` com `org_id` único, `api_key_encrypted`, `base_url`, `sip_domain`, `sip_wss_url`; opção B: colunas em `organizations`). Checkpoint 1 de schema antes da migration.
- **Sincronização de ramais:** com o token da org, o app chama `GET /extensions`. Para quem **já tem** linha em `api4com_connections`, casa pelo **número do ramal** e só completa `sip_domain` (= `domain`) e `sip_password_encrypted` (= `encrypt(senha)`). Para quem **não tem**, casa `email_address` com o e-mail do usuário (`resolveUserEmails`, que já lê `auth.users`; minúsculas e sem sufixo `+alias`); se houver mais de um ramal para o e-mail, o gestor escolhe. Roda ao salvar o token e por um botão "Sincronizar ramais" na tela de integrações. Sem par → "sem ramal".
- **Migrar `POST /dialer` → `POST /calls`** em `originateCall` (payload `{ extension, caller: extension, called: +55…, metadata }`), subir o timeout do `api4comFetch` nessa chamada para cobrir o toque do ramal (30 s) e usar o `id` devolvido como `api4com_call_id`. Como esse id é o mesmo do webhook, o fallback por ramal + número e o worker `back-associate` passam a ser só rede de segurança.
- `getCredentials` (`api4com.service.ts`) passa a resolver: token da org → ramal do usuário. Mantém o token por usuário como fallback enquanto houver linhas antigas, para não quebrar quem já está configurado.
- Tela de integrações: gestor configura token e base URL uma vez (só `requireManager`) e vê a lista de SDRs com o ramal casado. O modal por usuário vira só leitura, com edição manual do ramal apenas como exceção.
- Registro do webhook (`registerCallWebhook`) passa a rodar uma vez por org, não por usuário. Rotas admin `reregister-api4com-webhooks` e `check-api4com-config` ajustadas para a credencial da org.
- Reconcile (`reconcile-api4com-calls`) e recuperação de gravações usam a credencial da org (já usam "a primeira conexão"; vira explícito).

### Bloco 2 — Áudio no navegador
- `pnpm add jssip` (+ `@types/jssip`). Hook `useApi4ComWebphone` que registra o ramal em `wss://{sip_domain}:6443` ao entrar em qualquer página do `(app)`, mantém o registro vivo (reconexão automática do JsSIP) e expõe `status`, `answer`, `hangup`, `mute`, `stats`. Uma instância por aba; o JsSIP vive num singleton de módulo, não em estado React.
- Credenciais SIP vão ao cliente por uma action **nova e mínima** (só `sipDomain`, `ramal`, `sipPassword`; nunca o token da API). A action antiga `getApi4ComSipCredentials` é removida.
- Auto-atendimento da perna do ramal quando o INVITE chega com `X-Api4comintegratedcall: true`. Chamada recebida sem esse cabeçalho (inbound real) toca no painel com "Atender/Recusar".
- Ligação de saída: `initiateCall` chama `POST /calls`; o painel entra em "Chamando…" assim que o INVITE chega e passa a "Em ligação" quando o navegador atende o ramal, sem esperar o webhook.
- Desligar no painel encerra a sessão WebRTC **e** chama `hangupApi4ComCall` (já existe) como garantia.
- Pedido de permissão de microfone com mensagem clara quando negado.
- Se a extensão do Chrome estiver registrada no mesmo ramal, o registro da página falha ou disputa a chamada: o painel mostra "Feche a extensão API4COM" (detectar por `registrationFailed` ou por chamada não entregue em N segundos).

### Bloco 3 — Painel flutuante
- Componente `WebphonePanel` montado no layout `(app)`, flutuante, arrastável com `@dnd-kit/core` (já está no `package.json`), posição lembrada em `localStorage`.
- Estados: oculto (sem ligação), "Chamando…", "Em ligação" (cronômetro, Desligar, Mutar, anotações), "Ligação finalizada" (tempo, anotações, Concluir).
- Ao concluir, abre o `CallResultModal` já existente (desfecho + anotações viram `classifyWebphoneCall`, sem mudança de contrato).
- Avaliação de áudio opcional (1 a 5 estrelas) depois de concluir, gravada em `calls.metadata.audio_quality`, mais `calls.metadata.audio_stats` lido de `session.connection.getStats()` ao desligar (perda de pacotes, jitter, RTT). Nada de coluna nova nesta story.
- O `ActivityPhonePanel`, `PowerDialerTab` e `LeadDetailLayout` deixam de pedir para "abrir a extensão" quando o webphone está registrado; mantêm a mensagem só como fallback quando o registro falhou.

## Critérios de aceite
- [ ] Gestor cadastra o token da API4COM uma única vez para a organização; os ramais dos SDRs são preenchidos sozinhos pelo e-mail e um SDR que nunca abriu a tela de integrações consegue ligar.
- [ ] SDR cujo e-mail não existe na conta API4COM aparece na lista do gestor como "sem ramal", e o botão "Ligar" dele avisa isso em vez de falhar em silêncio.
- [ ] Com a extensão do Chrome **fechada**, o SDR clica em "Ligar" na fila de atividades, ouve o lead e é ouvido pela página do EnriqueceAI.
- [ ] O botão "Desligar" do painel encerra a ligação dos dois lados em até 2 s; a linha em `calls` recebe `duration_seconds` e `hangup_cause` pelo webhook como hoje.
- [x] O painel é arrastável, continua visível ao trocar de tela dentro do app e lembra a posição. *(implementado no bloco 3; conferência visual pendente na validação em produção)*
- [ ] Mutar funciona e é visível no painel.
- [ ] A ligação sai por `POST /calls` (não mais `/dialer`) e casa com o webhook pelo `api4com_call_id` (sem cair no casamento por ramal + número); gera gravação e transcrição como hoje.
- [ ] "Sincronizar ramais" preenche ramal, domínio e senha SIP de cada SDR a partir de `GET /extensions`, casando por e-mail; nenhuma senha aparece na tela.
- [x] Avaliação de áudio opcional é gravada em `calls.metadata.audio_quality`; "Pular" não grava nada. *(implementado no bloco 3, com testes da action)*
- [ ] Microfone negado ou registro SIP falhando mostram mensagem específica e o botão "Ligar" cai no comportamento atual (`POST /dialer` + extensão) em vez de falhar em silêncio.
- [ ] `getApi4ComSipCredentials` removida; nenhuma action devolve o token da API ao navegador.
- [ ] Nenhum erro de console nas páginas autenticadas com o webphone montado (o motivo do PR #23 não pode voltar).
- [ ] Dashboard, Estatísticas, Sales Hub e `get_calls_for_v4sales` não mudam: a métrica de conexão continua vindo de `answered_at` do webhook.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test:run` e `pnpm build` passam; `pnpm gen:types` rodado no mesmo PR da migration. *(verde nos três blocos; bloco 3 não tem migration)*

## Critério de pronto
A story está pronta quando os três PRs estão no ar, a validação em produção (seção abaixo) foi cumprida com um SDR por um dia inteiro sem a extensão, o gestor consegue cadastrar o token e sincronizar ramais pela tela, e a métrica de conexão desse SDR no dia ficou na faixa do time. A action `getApi4ComSipCredentials` não existe mais. Estatísticas, Dashboard e Sales Hub não mudaram de número por causa desta story.

## Fora de escopo
- Discar por INVITE direto do navegador (sem `POST /dialer`).
- Ligação via WhatsApp (`features/whatsapp-calls`), que já tem o próprio WebRTC.
- Transferência, conferência, gravação local, histórico de chamadas no painel.
- Remover a extensão das máquinas dos SDRs (é operacional; a story só precisa funcionar com ela fechada).
- Org Julio Cesar: segue com a configuração por usuário até validar na V4 Amaral.

## Riscos
- **Empacotamento da lib** (foi o que matou a versão de março). Mitigação: JsSIP do npm (sem CDN, sem `window.require`) e provar o registro SIP num protótipo isolado antes de tocar no layout.
- **`POST /calls` só responde depois que o ramal atende.** Com o auto-atendimento no navegador é rápido, mas se a aba não estiver registrada a resposta demora até o `no_answer_timeout`. Mitigação: só chamar `/calls` com o webphone em `registered`; senão cair no fluxo antigo com aviso.
- **Limite de 15 chamadas/min por ramal** no `/calls`. O Power Dialer sequencial fica dentro; evitar rediscagem automática em laço.
- **Disputa de ramal** entre extensão e página. Mitigação: detecção + mensagem; combinar com o time o dia de desligar a extensão.
- **Aba fechada = telefone desligado.** Inbound deixa de tocar se o SDR fechar o app. Mitigação: documentar; inbound não é o foco do time hoje.
- **Microfone/headset** no navegador exigem permissão por domínio e podem variar entre máquinas.
- **Casamento do webhook** se o `X-Api4comintegratedcall` não vier: cai no fallback por ramal + número (já existe), com risco de duplicata como visto em set/2026.

## Dados e migração
- Nova tabela ou colunas para o token da org (decidir A/B no Checkpoint 1). RLS: leitura só do próprio org; escrita só `is_manager()`.
- `api4com_connections` mantém `ramal`, `sip_password_encrypted` e ganha `api4com_user_id` (id do usuário na API4COM) e `synced_at`; `api_key_encrypted` por usuário vira opcional e é apagado quando a org tiver token.
- E-mail do usuário vem de `auth.users` via `resolveUserEmails` (service role), nunca de um campo digitado.
- Backfill: copiar o token do primeiro usuário conectado de cada org para o nível da org (com backup `_bkp_api4com_connections_<data>` com RLS + REVOKE).

## Validação em produção
0. Antes de codar: com o token atual da V4 Amaral, chamar `GET /extensions` e conferir que `email_address` e `senha` vêm preenchidos para os ramais do time e que os e-mails batem com `auth.users`. Depois um `POST /calls` de teste com esse token para um ramal que não é o do dono do token (confirma o "token pai serve para todos").

### Resultado do passo 0 (21/10/2026, só leitura; `POST /calls` NÃO testado)
Sondagem rodada dentro do container do app no Coolify (a chave de cifra só existe lá), com os 7 tokens cadastrados em `api4com_connections` da V4 Amaral.

- **Token:** os 7 tokens (6 `USER` + o do Vini, `ADMIN`) listam os **55 ramais da conta com `senha` e `email_address` preenchidos**. `GET /users` devolve 43 usuários com `role`. Não há barreira para o token único.
- **Campos extras do `GET /extensions`** não documentados: `webhook_cdr_url`, `webhook_body_version`, `webhook_event_types` (webhook **por ramal**, hoje vazio em todos os nossos), `pipedrive_*`, `sharpspring_*`.
- **Casamento por e-mail, estado real:**

| SDR (e-mail no app) | Ramal no app | Ramais na API4COM com esse e-mail |
|---|---|---|
| vinicius.mercante@ | 1014 | 1014 está em `vinicius.mercante**+1**@` (alias, **não casa**); **1054** casa exato |
| ismael.dobelin@ | 1024 | 1024 e **1049** |
| matheus.m.santos@ | 1028 | 1028 e **1052** |
| guilhermefernandes.marques@ | 1033 | 1033 e **1048** |
| giovanniolivieri@ | 1042 | 1042 e **1047** |
| joao.fogaca@ | 1045 | 1045 e **1051** |
| rafael.alecio@ (suspenso) | 1040 | 1040 |
| jhonata.banqueri@ (suspenso) | nenhum | 1026 e **1050** |
| analuiza@v4companyamaral.com | nenhum | **nenhum ramal** |

- ⚠️ **Os ramais 1047–1054 são novos e duplicados**, um por pessoa do time, com nome completo e senha de 12 caracteres: foram criados pela integração do CRM da matriz (provável `POST /extensions/next-available`). O 1054 (Vini) já tem 2 ligações hoje com `gateway: mars-voip`, que é a integração da matriz. Consequências: (a) casar só por e-mail é **ambíguo** para todo o time; (b) ligações feitas pela matriz nesses ramais **não casam com nenhum usuário** no EnriqueceAI (o webhook e o reconcile mapeiam ramal → usuário por `api4com_connections.ramal`), então somem da efetividade e do BI.
- **Regra de sync derivada disso:** se o usuário já tem linha em `api4com_connections`, manter o ramal dela e só completar `sip_domain`/`senha`; se não tem e o e-mail casa com mais de um ramal, listar para o gestor escolher; e-mail sem ramal → "sem ramal". Comparar e-mails em minúsculas e **sem o sufixo `+alias`** antes do `@` (caso do Vini).
- **Decisão (Vini, 21/10/2026): manter os ramais antigos** (1014/1024/1028/1033/1042/1045). O Vini pede à matriz para apontar o CRM deles para esses ramais em vez dos 1047–1054. Para o sync desta story, a regra fica: o ramal que já está em `api4com_connections` é a fonte da verdade; o sync só completa `sip_domain` e `senha` a partir do `GET /extensions` pelo **número do ramal**, não pelo e-mail. O casamento por e-mail entra só para usuário **sem** linha, e aí com a escolha do gestor quando houver mais de um ramal.
- **Limpeza recomendada depois que a matriz migrar:** remover os ramais 1047–1054 na API4COM (`DELETE /extensions/{id}`; ids 249375–249378 e os quatro seguintes) para não voltarem a confundir o casamento. Só depois de confirmar que não há ligação neles por alguns dias. Fora do escopo desta story.
- **Não feito:** `POST /calls` com o token de uma pessoa para o ramal de outra (precisa de número de destino e faz um ramal tocar).
1. Ligação de teste do Vini com extensão fechada, conferindo no banco: `metadata.api4com_call_id`, `answered_at`, `duration_seconds`, `recording_url`.
2. Um SDR por um dia inteiro com a extensão fechada; comparar conexão (`answered_at IS NOT NULL`) com a média do time.
3. Só então liberar para os demais.

## Dev Agent Record

### Bloco 1 — implementado em 21/10/2026 (branch `feat/api4com-org-token-calls`, worktree `EnriqueceAI_Pro-webphone`)
- [x] Migration `20261021175620_api4com_org_settings.sql`: tabela `api4com_org_settings` (token da org, base URL, domínio, última sync; RLS: membros leem, só `is_manager()` escreve) + colunas `api4com_extension_id` e `synced_at` em `api4com_connections`. **Aplicada em produção em 21/10/2026 (versão registrada `20261021175620`; o arquivo foi renomeado para bater)** e `pnpm gen:types` rodado (+47 linhas em `types.ts`).
- [x] `api4com.service.ts`: `getUserCredentials` resolve token da org → ramal do usuário, com o token por usuário como fallback; `getOrgApiCredentials` para operações por org; `originateCall` migrado de `POST /dialer` para **`POST /calls`** (`extension`, `caller`, `called` em E.164 via `toApi4ComCalled`, `metadata`), timeout 40 s e **sem retry** (repetir poderia discar duas vezes); `listExtensions` (`GET /extensions`); `ensureCallWebhookWithCredentials`.
- [x] `api4com-extension-sync.ts` (puro): plano de sync — linha existente casa pelo **número do ramal**; sem linha casa por e-mail (minúsculas, sem `+alias`); 1 ramal → cria, 2+ → ambíguo, 0 → sem ramal. 12 testes.
- [x] `manage-api4com-org.ts`: `saveApi4ComOrgSettings` (valida pelo `GET /extensions`, grava, garante webhook, sincroniza), `syncApi4ComExtensions`, `disconnectApi4ComOrg`, `fetchApi4ComOrgOverview`. Só gestor.
- [x] UI: `Api4ComOrgCard` (token da conta, domínio, última sync, botão "Sincronizar ramais", tabela do time com ramal/senha SIP/sincronizado, pendências do sync) + `Api4ComOrgTokenModal`. Montado em `IntegrationsView` abaixo da linha do API4Com, só para gestor. A linha do SDR mostra "via conta da organização" quando usa o token da org.
- [x] Reconcile, recuperação de gravação, rota de gravação, `check-api4com-config`, `reregister-api4com-webhooks` e "Testar" usam a credencial da org (fallback: token legado do usuário). No reconcile, 401/403 marca `error` em todos os ramais da org.
- [x] `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test:run` ✅ 2519 testes (308 arquivos) · 22 testes novos.
- [x] Aplicar a migration em produção + `pnpm gen:types` (mesmo PR).
- [ ] Validação em produção (seção "Validação", passos 1–3). `POST /calls` ainda não foi disparado em produção.
- [ ] CodeRabbit: CLI configurado só em WSL; não rodado neste Mac.

### Bloco 2 — implementado em 21/10/2026 (branch `feat/api4com-webphone-browser`, mesmo worktree)
- [x] `jssip` 3.13.9 (tipos próprios do pacote; `@types/jssip` é um stub vazio e foi descartado).
- [x] Migration `20261021185445_api4com_webphone_enabled.sql`: coluna `api4com_connections.webphone_enabled` (default `false`). Rollout por pessoa: o gestor liga um SDR por vez. Aplicada em produção em 21/10 (0 ligados) e `gen:types` rodado.
- [x] `webphone-state.ts` (puro): reducer do estado do webphone (registro, microfone, ligação com fases tocando/em ligação/encerrada, mudo), `isIntegratedCallHeader`, `canReceiveCalls`, `callTalkSeconds`. 12 testes.
- [x] `webphone-client.ts`: singleton JsSIP por aba — registra `sip:{ramal}@{domínio}` em `wss://{domínio}:6443` (realm = domínio, `register_expires` 600, `no_answer_timeout` 30, reconexão 2–30 s), pede o microfone no start, atende sozinho o INVITE com `X-Api4comintegratedcall: true`, inbound comum fica tocando até "Atender", segunda chamada recebe 486, áudio remoto num `<audio>` escondido, `answerCall`/`hangupCall`/`toggleMute`/`stopWebphone`. Guarda de geração contra o duplo mount do StrictMode.
- [x] `useApi4ComWebphone` (`useSyncExternalStore`) e `Api4ComWebphoneMount` no layout `(app)`: busca `getWebphoneSipConfig()`, só registra se o gestor liberou, e mostra um indicador fixo mínimo (status do registro; durante a ligação: número, fase, cronômetro, Atender/Mutar/Desligar). O painel flutuante arrastável com anotações e avaliação é o bloco 3.
- [x] `getWebphoneSipConfig` (nova action mínima: domínio, ramal e senha SIP do próprio usuário, só com `webphone_enabled`) e **`getApi4ComSipCredentials` removida** (devolvia o token da API ao navegador). 3 testes.
- [x] Cartão do gestor: coluna "Webphone" com liga/desliga por pessoa (`setWebphoneEnabled`; exige ramal com senha SIP sincronizada).
- [x] `ActivityPhonePanel`: com o webphone registrado nesta aba, o lembrete amarelo da extensão vira um aviso verde "Webphone ativo nesta aba" e a mensagem de erro deixa de mandar abrir a extensão. `PowerDialerTab` e `LeadDetailLayout`: mesmas mensagens condicionais.
- [x] Aplicar a migration em produção + `pnpm gen:types`.
- [x] **Validação de ponta a ponta (localhost + API4COM real, 21/10 19:14 UTC):** Vini ligou para o próprio celular sem a extensão; a página atendeu a perna do ramal, o celular atendeu, 174 s de conversa, `answered_at` 19:14:34, `NORMAL_CLEARING`, gravação e `webhook_linked` pelo id (`f0075b2e…`). Mais duas ligações no mesmo teste (16 s atendida; uma cancelada) também casaram pelo id. Falta só a validação em produção depois do deploy (um SDR um dia inteiro).
- [x] **Registro SIP real validado no localhost (21/10):** o ramal 1014 registrou em `wss://v4amaral.api4com.com:6443` e o indicador mostrou "Webphone ativo". Para isso foi preciso liberar a porta na CSP: `connect-src` tinha `wss://*.api4com.com`, que no CSP só vale para a porta padrão (443); adicionado `wss://*.api4com.com:6443` em `next.config.ts`. Áudio/atendimento validados pelo Vini no Chrome (localhost, 21/10 19:08 UTC): a página atendeu sozinha a perna do ramal e a ligação saiu com `webhook_linked` pelo id (`5a89a7ce…`); o destino devolveu `NUMBER_CHANGED` (0 s, gravação do aviso da operadora), então falta uma ligação atendida de ponta a ponta. Ajustes feitos nesse teste: registro sem esperar o microfone, indicador no canto esquerdo (atrás dos toasts à direita), `dialingBlockReason` trava o Ligar enquanto o webphone não está pronto.

### Bloco 3 — implementado em 21/10/2026 (branch `claude/busy-antonelli-d472c3`, worktree `busy-antonelli-d472c3`)
- [x] `WebphonePanel.tsx`: painel flutuante no layout `(app)` (via `Api4ComWebphoneMount`, só para quem tem `webphone_enabled`), arrastável pelo cabeçalho com `@dnd-kit/core` (`PointerSensor`, distância 4 px), posição em `localStorage` (`enriqueceai.webphone.panel-position.v1`, try/catch, padrão canto inferior esquerdo, re-limitada à viewport no resize). Estados: pill com o status do registro quando não há ligação; "Chamando…"/"Chamada recebida" (Atender para inbound real); "Em ligação" com nome do lead (quando conhecido), número, cronômetro, Mutar e Desligar; "Ligação finalizada" com tempo (ou "Não atendida"), anotações e Concluir; depois "Como estava a qualidade do áudio?" com 5 estrelas (Pular/Enviar). O indicador mínimo do bloco 2 foi removido.
- [x] `webphone-call-context.ts` (+ hook `useWebphoneCallContext`): store de módulo com o contexto da ligação (`callId` de `calls`, id na API4COM, lead, número, `ownerHandlesResult`) e as anotações do painel. Os três discadores publicam o contexto logo depois de `initiateCall` (`ActivityPhonePanel` — substitui o `CustomEvent` `webphone:call-context` que ninguém ouvia —, `PowerDialerTab`, `LeadDetailLayout`). Reducer puro, 10 testes.
- [x] Resultado sem modal duplicado: quem iniciou a ligação e tem `CallResultModal` (fila de atividades, Power Dialer) continua dono. "Concluir" no painel dispara `webphone:conclude-requested`; o discador dono vai para `ended` na hora (sem esperar o webhook pelo Realtime) e abre o modal dele com as anotações do painel pré-preenchidas (`initialNotes`, prop opcional nova do `CallResultModal`; o contrato de `classifyWebphoneCall` não mudou). Se o discador desmontou no meio da ligação (trocou de tela) ou a ligação veio do detalhe do lead (que não tem modal), o painel abre o próprio `CallResultModal` e grava por `classifyWebphoneCall` + `scheduleActivity`, como os discadores fazem. Um contexto esquecido não gruda numa chamada recebida depois (`contextMatchesCall`, janela de 60 s).
- [x] `webphone-audio-stats.ts` (puro): `summarizeRtcStats` resume o `RTCStatsReport` (`inbound-rtp` de áudio → pacotes recebidos/perdidos/% perda/jitter; `candidate-pair` nomeado ou `remote-inbound-rtp` → RTT). O cliente amostra `session.connection.getStats()` a cada 5 s durante a conversa e tenta uma amostra final (até 400 ms) antes do BYE quando o Desligar é daqui — quando o outro lado desliga, a `RTCPeerConnection` já está fechada no `ended`, então vale a última amostra. Evento `call_stats` no reducer. 6 + 1 testes.
- [x] `saveWebphoneCallAudio` (action nova, `features/calls/actions`) + `webphone-audio.schemas.ts`: grava `calls.metadata.audio_quality` (1–5) e/ou `calls.metadata.audio_stats` mesclando no metadata atual (`api4com_call_id`, `gateway`… preservados); só o autor da ligação (`calls.user_id`) na própria org; nunca toca em `status`/`duration_seconds`. "Pular" não chama nada. `audio_stats` é gravado uma vez, automaticamente, quando a ligação atendida termina. 5 + 7 testes.
- [x] Desligar no painel: `hangupCall()` do cliente (perna WebRTC) **e** `hangupApi4ComCall` pelo id da API4COM do contexto, como garantia. O botão do painel de atividades continua fazendo o dele; nenhum dos dois chama o outro.
- [x] `webphone-panel-position.ts` (puro): parse/load/save com try/catch, `clampPanelPosition`, `movePanelPosition`. 7 testes.
- [x] `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test:run` ✅ 2575 testes (316 arquivos; 50 novos) · `pnpm build` ✅. Sem migration neste bloco (`gen:types` não se aplica).
- [ ] Validação no navegador com a API4COM real (só o Vini tem o webphone ligado): arrastar e posição lembrada, cronômetro, Mutar, Desligar em até 2 s, anotações chegando ao modal da atividade, estrelas gravando `audio_quality`, `audio_stats` preenchido, e conferir que não há erro de console com o painel montado.
- [ ] CodeRabbit: CLI configurado só em WSL; não rodado neste Mac.

### Ajustes pós-produção — 22/10/2026 (branch `fix/webphone-result-modal`, worktree `EnriqueceAI_Pro-webphone`)
Teste do Vini em produção (21/10, 21:34 e 21:40 BRT, página do lead, destino com NUMBER_CHANGED/ORIGINATOR_CANCEL):
- A ligação das 21:40 gravou `audio_quality` 5 e `audio_stats`; anotações e desfecho NÃO, porque o `CallResultModal` foi fechado por clique fora/Esc (o painel flutuante fica visível atrás e convida ao clique) e o painel pulou direto para as estrelas. A das 21:34 não gravou nada (contexto não casou; sem registro do navegador para confirmar o motivo).
- O painel mostrou "00:06" como atendida: o cliente SIP atende a perna do RAMAL na hora, então `answeredAt` nunca diz se o LEAD atendeu. Isso também fazia o modal exigir desfecho em vez de preencher "Não atendeu".
- Na fila de atividades o clique no ícone da API4COM deu erro 424 `call from 1014 to +55… has been failed` às 21:34:38 — 15 s depois de outra ligação do mesmo ramal ter acabado no navegador e 8 s ANTES de o webhook dela chegar: a API4COM ainda tinha o ramal ocupado. Nenhuma chamada nasce nesse caso.

Feito:
- [x] `CallResultModal`: prop `dismissible` (padrão `true`); com `false`, clique fora e Esc não fecham (só "Concluir" ou o ×). O painel flutuante passa `dismissible={false}`. 3 testes.
- [x] `webphone-lead-answer.ts` (puro) + action `getWebphoneCallOutcome` + hook `useWebphoneLeadAnswer`: o painel consulta a linha de `calls` a cada 3 s (até 40 vezes) enquanto o webhook não gravou `answered_at` nem `hangup_cause`. `answered_at` → atendida; `hangup_cause` sem `answered_at` → "Não atendida"; o modal recebe `connected` por esse sinal (cai no atendimento do ramal só enquanto "desconhecido"). Em ligação integrada, o título fica "Chamando o lead…" até o webhook confirmar. 4 + 4 testes.
- [x] `originateCall`: no 424 "has been failed" (perna do ramal) repete UMA vez após 3 s — seguro porque nenhuma chamada nasceu (o timeout continua sem retry). `describeOriginateError` traduz os dois 424 conhecidos em mensagem para o SDR; `initiateApi4ComCall` usa, então fila, Power Dialer e página do lead mostram o mesmo texto. 3 + 2 testes.
- Typecheck, lint e testes verdes. Nada commitado.

### "Atendida" pelo webhook na fila e no Power Dialer — 22/10/2026 (branch `fix/webphone-queue-lead-answer`)
Teste do Vini na fila (22/10, 05:59–06:07 BRT): ligações com `NUMBER_CHANGED`/`ORIGINATOR_CANCEL` (lead não atendeu; "caixa postal" = mensagem da operadora) apareciam no modal da fila como "Atendida · 00:05/00:07". O PR #490 só corrigira o modal aberto pelo painel na página do lead; a fila usava `connected={callDuration > 0}` com o tempo da perna do ramal. E "Ligar de novo" gravou 9 s numa ligação não atendida: `classifyWebphoneCall` usava o tempo da tela sempre que `duration_seconds` era 0 — inclusive DEPOIS do webhook ter fechado a ligação com 0 s.
- [x] `leadConnected` / `effectiveCallSeconds` movidos para `webphone-lead-answer.ts` (puros, compartilhados).
- [x] `ActivityPhonePanel`: `useWebphoneLeadAnswer(callId)` quando a chamada termina; modal recebe `connected` e duração por esse sinal (não atendida → "Não atendida", 0 s, "Ligar de novo" principal); tentativas e `classifyWebphoneCall` recebem 0 s.
- [x] `PowerDialerTab` / `DialerCallPanel`: selo "Atendida"/"Não atendida" pelo webhook; não atendida → "Tentar novamente" vira o botão principal. (A duração do Power Dialer já saía 0: o timer zera ao encerrar.)
- [x] `WebphonePanel`: manda 0 s ao concluir ligação não atendida.
- [x] `CallResultModal`: se o sinal muda com o modal aberto (webhook chega depois), reaplica o padrão quando o SDR não mexeu no desfecho OU a escolha deixou de valer para a telemetria. 3 testes.
- [x] `classifyWebphoneCall`: não usa o tempo da tela quando a linha já tem `hangup_cause`. 2 testes (arquivo novo).
- ⚠️ Fora do escopo, só registrado: `completeDialerCall` (Power Dialer) cria uma SEGUNDA linha em `calls` (`origin='power_dialer'`, 0 s) além da criada pelo `initiateCall` — 31 em out/2026, 348 em jul/2026.

### Painel dentro da gaveta da fila — 22/10/2026 (branch `fix/webphone-panel-in-sheet`)
Na fila de atividades o painel flutuante não aparecia durante a ligação: a tarefa abre numa gaveta Radix (`Sheet`) de tela cheia com overlay `z-50` desenhada em portal DEPOIS do layout, então cobria o painel. Só subir o `z-index` não bastava: com a gaveta aberta o Radix bloqueia cliques fora dela, prende o foco (não daria para digitar as anotações) e fecha a gaveta no clique externo.
- [x] `webphone-panel-host.ts` (registro em pilha) + `WebphonePanelHost.tsx` (encaixe + hook `useWebphonePanelHost`). A gaveta de execução monta o encaixe dentro do `SheetContent`; o `WebphonePanel` se desenha nele via `createPortal` enquanto existir e volta ao layout quando a gaveta fecha. Mesma posição (o painel é `position: fixed`, posição salva em `localStorage`).
- [x] 4 testes, incluindo um com a gaveta real do Radix: o painel fica dentro do conteúdo da gaveta, aceita digitação e o clique nele não a fecha. O mesmo teste FALHA sem o encaixe.
- Não verificado no navegador: o webphone local exige a `TOKEN_ENCRYPTION_KEY` de produção no `.env.local`. Validar em produção após o deploy.

### Decisões do dev (bloco 3)
- O painel **não** abre um segundo `CallResultModal` quando a fila de atividades ou o Power Dialer está na tela: pede ao discador para concluir (evento de janela) e ele usa o modal que já tem. Só assume o resultado quando ninguém mais vai fazê-lo (discador desmontado ou ligação do detalhe do lead). Evita a tela com dois modais e mantém `onMarkDone`/tentativas/re-discagem onde já estavam.
- A "fotografia" da ligação encerrada fica no painel (não no cliente JsSIP): o cliente continua limpando a ligação 2,5 s depois do fim para liberar a próxima; o painel guarda número, duração, estatísticas e contexto até o SDR concluir. `doneCallId` evita re-fotografar a mesma ligação nessa janela.
- Estatísticas por amostragem (5 s) em vez de uma leitura só no fim: no desligamento remoto o JsSIP fecha a `RTCPeerConnection` antes de emitir `ended` e `getStats()` deixa de responder.
- Quando o dono conclui ou fecha o modal dele, o painel pula direto para a avaliação de áudio (opcional); sem `callId` conhecido (inbound que não passou por `initiateCall`) não há o que avaliar e o Concluir só fecha.
- `CallResultModal` ganhou só a prop opcional `initialNotes`; a Ligação via WhatsApp (que também usa o modal) não passa nada e segue igual.

### Decisões do dev (bloco 2)
- Flag por pessoa em vez de por org: a validação pede um SDR por um dia, e a extensão e a página disputam o mesmo ramal, então ligar para todos de uma vez travaria quem ainda usa a extensão.
- O cabeçalho é lido do `request` do evento `newRTCSession` (o `RTCSession` tipado não expõe `request`).
- A ligação de saída continua sendo originada pelo servidor (`POST /calls`); o webphone só atende a perna do ramal. Nada mudou no casamento com o webhook.
- O indicador do bloco 2 é propositalmente mínimo (fixo no canto); arrastar, anotações e estrelas ficam no bloco 3.

### Decisões do dev (bloco 1)
- O token por usuário continua funcionando (fallback) para não quebrar quem já está configurado; a org Julio Cesar segue assim até cadastrar o token dela.
- `getApi4ComSipCredentials` (action morta que vaza token) fica para o bloco 2, que a substitui pela action mínima do webphone.
- A linha do SDR em `api4com_connections` criada pelo sync nasce com `api_key_encrypted = null` e `base_url` da org.
- `GET /extensions` em contas grandes: sem paginação na doc; a V4 Amaral tem 55 ramais e a chamada volta inteira.

### Fim da avaliação de áudio com estrelas — 22/10/2026 (branch `feat/webphone-no-rating`)
Pedido do Vini: "fica muito clique pra fazer o SDR". Sai só a etapa "Como estava a qualidade do áudio?" (5 estrelas + Enviar/Pular). A tela "Ligação finalizada" (anotações + Concluir) continua — uma 1ª versão desta branch tirou as duas por engano e foi desfeita a pedido do Vini.
- [x] `WebphonePanel`: sem `RatingView`/`handleRate`/etapa `rating`. Depois do Concluir (dono avisado, modal do próprio painel concluído ou fechado, ou dono que concluiu pelo próprio modal) o painel some. `audio_stats` continua sendo gravado sem clique; `audio_quality` deixa de ser coletado.
- [x] `PowerDialerTab`: concluir no manual com o formulário sem texto (só as marcações "[]") usa as anotações do painel (`hasWrittenNotes`) — o painel manda as anotações no evento, mas o Power Dialer as ignorava.
- [x] Testes: `WebphonePanel.test.tsx` (3, ligação atendida; todos falham na versão com estrelas), +1 no `PowerDialerTab.auto.test.tsx`, `call-attempt.notes.test.ts` (2).
- ⚠️ Critério de aceite "Avaliação de áudio opcional é gravada em `calls.metadata.audio_quality`" deixou de valer por decisão do Vini — @po ajustar.

## File List
Bloco 1 (feito):
- `supabase/migrations/20261021175620_api4com_org_settings.sql` (novo)
- `src/features/integrations/services/api4com.service.ts`
- `src/features/integrations/services/api4com.service.test.ts` (novo)
- `src/features/integrations/services/api4com-extension-sync.ts` (novo)
- `src/features/integrations/services/api4com-extension-sync.test.ts` (novo)
- `src/features/integrations/actions/manage-api4com-org.ts` (novo)
- `src/features/integrations/actions/test-connections.ts`
- `src/features/integrations/components/Api4ComOrgCard.tsx` (novo)
- `src/features/integrations/components/Api4ComOrgTokenModal.tsx` (novo)
- `src/features/integrations/components/IntegrationsView.tsx`
- `src/features/integrations/types/api4com.ts`, `src/features/integrations/types/index.ts`
- `src/app/(app)/settings/integrations/page.tsx`
- `src/app/api/workers/reconcile-api4com-calls/route.ts`
- `src/app/api/admin/check-api4com-config/route.ts`, `src/app/api/admin/reregister-api4com-webhooks/route.ts`
- `src/app/api/calls/recording/[callId]/route.ts`
- `src/features/calls/services/recover-recording.service.ts`
- `src/lib/supabase/types.ts` (regenerado)

Bloco 2 (feito):
- `supabase/migrations/20261021185445_api4com_webphone_enabled.sql` (novo)
- `src/lib/supabase/types.ts` (regenerado)
- `src/features/integrations/webphone/webphone-state.ts` + `.test.ts` (novos)
- `src/features/integrations/webphone/webphone-client.ts` (novo)
- `src/features/integrations/webphone/useApi4ComWebphone.ts` (novo)
- `src/features/integrations/webphone/Api4ComWebphoneMount.tsx` (novo)
- `src/features/calls/actions/get-webphone-sip-config.ts` + `.test.ts` (novos); `get-api4com-sip-credentials.ts` removido
- `src/features/integrations/actions/manage-api4com-org.ts` (`setWebphoneEnabled`, `webphoneEnabled` no overview)
- `src/features/integrations/components/Api4ComOrgCard.tsx`, `src/features/integrations/types/index.ts`
- `src/features/activities/components/ActivityPhonePanel.tsx`, `PowerDialerTab.tsx`
- `src/features/leads/components/LeadDetailLayout.tsx`
- `src/app/(app)/layout.tsx`
- `next.config.ts` (CSP: `wss://*.api4com.com:6443`)
- `package.json`, `pnpm-lock.yaml` (jssip)

Bloco 3 (feito):
- `src/features/integrations/webphone/WebphonePanel.tsx` (novo — painel flutuante arrastável, anotações, avaliação)
- `src/features/integrations/webphone/webphone-call-context.ts` + `.test.ts` (novos), `useWebphoneCallContext.ts` (novo)
- `src/features/integrations/webphone/webphone-audio-stats.ts` + `.test.ts` (novos)
- `src/features/integrations/webphone/webphone-panel-position.ts` + `.test.ts` (novos)
- `src/features/integrations/webphone/webphone-state.ts` + `.test.ts` (`audioStats`, evento `call_stats`)
- `src/features/integrations/webphone/webphone-client.ts` (amostragem de `getStats()`, `hangupCall` assíncrono)
- `src/features/integrations/webphone/Api4ComWebphoneMount.tsx` (monta o `WebphonePanel`; indicador mínimo removido)
- `src/features/calls/actions/save-webphone-call-audio.ts` + `.test.ts` (novos)
- `src/features/calls/schemas/webphone-audio.schemas.ts` + `.test.ts` (novos)
- `src/features/activities/components/CallResultModal.tsx` (prop opcional `initialNotes`)
- `src/features/activities/components/ActivityPhonePanel.tsx`, `PowerDialerTab.tsx` (publicam o contexto; respondem ao "Concluir" do painel; liberam o resultado ao desmontar)
- `src/features/leads/components/LeadDetailLayout.tsx` (publica o contexto; painel assume o resultado)

"Atendida" pelo webhook na fila e no Power Dialer (22/10):
- `src/features/integrations/webphone/webphone-lead-answer.ts` + `.test.ts` (`leadConnected`, `effectiveCallSeconds`)
- `src/features/integrations/webphone/WebphonePanel.tsx`
- `src/features/activities/components/ActivityPhonePanel.tsx`, `PowerDialerTab.tsx`, `DialerCallPanel.tsx`
- `src/features/activities/components/CallResultModal.tsx` + `.test.tsx`
- `src/features/calls/actions/classify-webphone-call.ts` + `.test.ts` (novo)

Painel dentro da gaveta (22/10):
- `src/features/integrations/webphone/webphone-panel-host.ts`, `WebphonePanelHost.tsx`, `webphone-panel-host.test.tsx` (novos)
- `src/features/integrations/webphone/WebphonePanel.tsx` (portal para o encaixe)
- `src/features/activities/components/ActivityExecutionSheet.tsx` (monta o encaixe)

Ajustes pós-produção (22/10):
- `src/features/activities/components/CallResultModal.tsx` + `.test.tsx` (prop `dismissible`)
- `src/features/integrations/webphone/webphone-lead-answer.ts` + `.test.ts` (novos), `useWebphoneLeadAnswer.ts` (novo)
- `src/features/integrations/webphone/WebphonePanel.tsx` (atendida = sinal do webhook; modal não descartável)
- `src/features/calls/actions/get-webphone-call-outcome.ts` + `.test.ts` (novos)
- `src/features/integrations/services/api4com.service.ts` + `.test.ts` (retry único no 424 de ramal; `describeOriginateError`)
- `src/features/calls/actions/initiate-api4com-call.ts` (mensagem amigável)

## Validação @po (21/10/2026)
Checklist de 10 pontos: 1 título ✅ · 2 descrição ✅ · 3 critérios testáveis ✅ · 4 escopo IN/OUT ✅ · 5 dependências ✅ (seção adicionada) · 6 estimativa ✅ (adicionada) · 7 valor de negócio ✅ · 8 riscos ✅ · 9 critério de pronto ✅ (adicionado) · 10 alinhamento ⚠️ (não há PRD/épico; origem é pedido direto do Vini com referência ao CRM da matriz, aceito como fonte). **Veredito: GO, 9/10.** Condições aplicadas nesta validação: estimativa, dependências, critério de pronto e entrega em 3 PRs por bloco. Observação para o @dev: tratar o bloco 1 como PR independente e só abrir o bloco 2 depois do protótipo isolado do registro SIP.

## Change Log
- 22/10/2026 — @dev: a pedido do Vini, a tela "Ligação finalizada" VOLTA (a 1ª versão do PR #501 tinha tirado por engano); sai só a avaliação com estrelas. Branch `feat/webphone-no-rating`.
- 22/10/2026 — @dev: removidas a tela "Ligação finalizada" e a avaliação com estrelas do painel (pedido do Vini: menos cliques); ao desligar abre direto o resultado. Branch `feat/webphone-no-rating`, PR #501.
- 22/10/2026 — @dev: fila de atividades e Power Dialer passam a usar o sinal do webhook ("Não atendida", 0 s, "Ligar de novo"/"Tentar novamente" em destaque); modal se atualiza quando o webhook chega; servidor não grava mais o tempo do ramal depois do webhook. Branch `fix/webphone-queue-lead-answer`. Nada commitado.
- 22/10/2026 — @devops: PR #491 mesclado (squash `6461d69`) e deploy confirmado às 05:46 BRT. Painel aparece dentro da gaveta da fila (validado pelo Vini).
- 22/10/2026 — @dev: painel flutuante passa a ser desenhado dentro da gaveta de execução da fila de atividades (branch `fix/webphone-panel-in-sheet`); antes ficava escondido atrás dela. Typecheck, lint e testes verdes. Nada commitado.
- 22/10/2026 — @devops: PR #490 mesclado (squash `00e3e50b`) e deploy confirmado às 22:16 BRT de 21/10.
- 22/10/2026 — @dev: ajustes pós-produção na branch `fix/webphone-result-modal`: modal de resultado do painel não fecha por clique fora/Esc; "Não atendida" e `connected` do modal passam a vir do webhook (`answered_at`/`hangup_cause`) em vez da perna do ramal; 424 "has been failed" ganha uma nova tentativa após 3 s e mensagem clara nos três discadores. Typecheck, lint e testes verdes. Nada commitado.
- 21/10/2026 — Teste do bloco 3 em produção pelo Vini (página do lead): painel reconheceu a ligação, gravou 5 estrelas e `audio_stats`; anotações/desfecho perdidos por fechamento acidental do modal; painel mostrava a perna do ramal como "atendida". Diagnóstico pelos logs do Supabase (edge_logs) e do container.
- 21/10/2026 — @devops: PR #489 mesclado (squash `d39784a8`) e deploy confirmado às 17:44 BRT. Bloco 3 NO AR — os três blocos em produção, flag ligada só para o Vini.
- 21/10/2026 — @devops: PR #488 mesclado (squash `cb836868`) e deploy confirmado às 16:29 BRT. Bloco 2 NO AR.
- 21/10/2026 — @dev: bloco 3 implementado no worktree `busy-antonelli-d472c3` (branch `claude/busy-antonelli-d472c3`): painel flutuante arrastável, anotações → `CallResultModal`, avaliação de áudio e `audio_stats` em `calls.metadata`, action `saveWebphoneCallAudio`. Typecheck, lint, testes e build verdes. Nada commitado; validação no navegador com a API4COM real pendente (Vini).
- 21/10/2026 — Bloco 2 validado de ponta a ponta no localhost com a API4COM real: ligação de 174 s atendida sem extensão, `answered_at`, gravação e webhook por id. Nada commitado.
- 21/10/2026 — Teste do bloco 2 no localhost (Chrome do Vini): ramal registrado, página atendeu a perna do ramal, ligação casou com o webhook pelo id. Destino deu NUMBER_CHANGED (0 s). Três ajustes após o primeiro erro 424 "user not registered" (registro sem esperar microfone, indicador à esquerda, trava do Ligar). Nada commitado.
- 21/10/2026 — @dev: migration `api4com_webphone_enabled` aplicada em produção (versão `20261021185445`, flag desligada para todos) e `pnpm gen:types` rodado.
- 21/10/2026 — @dev: bloco 2 implementado na branch `feat/api4com-webphone-browser` (JsSIP, auto-atendimento, action mínima, flag por SDR). Migration não aplicada; nada commitado.
- 21/10/2026 — @devops: PR #487 mesclado (squash `755b2c7c`) e deploy confirmado em produção pelo `/api/version` às 15:33 BRT. Bloco 1 NO AR. Restam blocos 2 e 3 e a validação em produção (passos 1–3).
- 21/10/2026 — Token da org cadastrado pelo Vini e ramais sincronizados (6 casados pelo ramal; Ana Luiza sem ramal). ⚠️ Feito pelo localhost com `TOKEN_ENCRYPTION_KEY` vazia → token e 6 senhas SIP gravados em claro; recifrados dentro do container de produção às 18:19 UTC (token validado em `/users/me`). Trava adicionada: `isEncryptionConfigured()` bloqueia salvar/sincronizar sem chave (3 testes). Ajuste ainda não commitado.
- 21/10/2026 — @devops: push da branch e PR #487 aberto para a main (https://github.com/v4amaraltech/EnriqueceAI-pro/pull/487). Aguarda CI e merge.
- 21/10/2026 — @dev: migration `api4com_org_settings` aplicada em produção via MCP (versão `20261021175620`) e `pnpm gen:types` rodado. Nada commitado.
- 21/10/2026 — @dev: bloco 1 implementado na branch `feat/api4com-org-token-calls` (typecheck, lint e 2519 testes ok). Status Ready → InProgress. Migration NÃO aplicada; `gen:types` pendente; nada commitado.
- 21/10/2026 — @po: validada (GO 9/10). Status Draft → Ready. Adicionados estimativa, dependências, critério de pronto e entrega em 3 PRs.
- 21/10/2026 — Story criada (Draft) a partir das telas do CRM da matriz e do histórico dos PRs #23/#25. Aguarda respostas da API4COM e do dev da matriz para fechar a abordagem do bloco 2.
- 21/10/2026 — Ajuste: o integrador da matriz pediu só token pai + e-mails dos usuários. Bloco 1 passa a descobrir ramais pela API e casar por e-mail; SDR não configura nada.
- 21/10/2026 — Decisão do Vini: manter os ramais antigos; matriz deve migrar para eles. Sync passa a casar por número de ramal para quem já tem linha; e-mail só para usuário novo.
- 21/10/2026 — Passo 0 rodado (só leitura): token serve para listar todos os ramais com senha e e-mail; descoberto que a integração da matriz criou ramais duplicados 1047–1054 para o time (ver "Resultado do passo 0"). `POST /calls` não testado.
- 21/10/2026 — Pesquisa na documentação oficial (developers.api4com.com v1.55.6): `GET /extensions` devolve e-mail + senha SIP por ramal; `wss://{domain}:6443`; auto-atendimento por `X-Api4comintegratedcall`; `POST /dialer` descontinuado → `POST /calls` (id igual ao do webhook). Abordagem fechada em JsSIP direto. Restam só 2 confirmações empíricas (seção "Validação", passo 0).
