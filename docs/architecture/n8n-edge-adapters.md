# Adaptadores de borda do n8n: contrato v1 e diff proposto dos workflows (PR13)

Status: implementado no app atrás da flag `edge_command_adapter` (escopo por organização, nasce desligada). **Nenhum workflow n8n foi lido, editado ou ativado por este PR.** Os diffs abaixo são propostas descritas a partir do inventário da seção 8 do plano (`call-cockpit-engine.md`) e das rotas `/api/v1/bdr/*` lidas neste repositório. As definições reais dos workflows não estão no repositório; antes de aplicar qualquer diff, o responsável deve conferi-las no n8n. Editar e ativar workflows é ação separada e aprovada.

## 1. Princípio

O n8n pede a decisão e registra o resultado. Quem decide destinatário, canal, provedor, consentimento, dono da conversa e bloqueio é o app. O n8n não informa telefone, e-mail, número nem provedor: campos desconhecidos são rejeitados (400).

Com a flag desligada, as rotas novas respondem 403 `adapter_disabled` sem ler nem gravar dado, e as rotas `/api/v1/bdr/*` seguem exatamente como hoje (este PR não altera nenhuma delas). Os workflows atuais continuam funcionando sem mudança.

## 2. Convenções comuns

- Versão: `contract_version: "edge-command.v1"` em toda resposta. Mudança incompatível entra em rota nova (`v2`); a v1 não muda de forma.
- Autenticação: igual às rotas `/bdr`, `Authorization: Bearer <api key>`. A organização vem da chave, nunca do corpo. Rate limit de 120 por minuto por organização e rota.
- Corpo JSON estrito (campos extras são 400 `invalid_request`).
- `idempotency_key`: 8 a 100 caracteres (`A-Z a-z 0-9 . _ : -`), escolhida pelo n8n. Sugestão: `<execution_id>:<tentativa>` para cadências e `<lead_id>:<id da mensagem>` para o agente. A mesma chave liga `authorize`, `result` e `email-send` da mesma ação.
- Idempotência: gravada em `decision_events` (índice único `org_id, idempotency_key` já existente, sem migration). A chave gravada é `edge.v1.<operação>.<sha256(org|operação|chave)>`, então a chave do cliente não colide entre organizações nem entre operações. O payload do evento tem só ids, códigos e motivos, sem PII.
- Falhas retentáveis: 503 com `retryable: true` e nada foi enviado. Falha de leitura ou de gravação da trilha nega (fail-closed).
- `next_action` orienta o n8n: `send`, `release` (chamar `/bdr/steps/release`, sem nova tentativa), `skip` (chamar `result` com `nao_enviado`) ou `none`.

## 3. Endpoints

### 3.1 `POST /api/v1/edge/messages/authorize`

Pede a decisão do gateway. Não envia nada.

```json
{ "workflow": "ana_whatsapp", "idempotency_key": "…", "execution_id": "<uuid>", "template": { "id": "…", "language": "pt_BR" } }
```

- `workflow`: `ana_whatsapp` ou `ana_email` (exigem `execution_id`) ou `ana_email_agent` (exige `lead_id`).
- `template` só no WhatsApp. `id` aceita o id da Meta ou o nome do template; `language` é opcional (padrão `pt_BR`, mesmo idioma que o envio atual usa). O n8n só indica qual template quer: **a aprovação é conferida pelo app** (ver 3.1.1).

Resposta 200:

```json
{ "contract_version": "edge-command.v1", "success": true,
  "data": { "idempotency_key": "…", "replay": false, "allowed": true, "next_action": "send",
            "provider": "meta_cloud", "requires_template": false, "template_id": null,
            "to": "5511…", "lead_id": "<uuid>" } }
```

Negada: `allowed: false`, `next_action` `skip` ou `release`, `retryable`, `reasons[]` (códigos do gateway, por exemplo `hold_total`, `no_consent`). `to` só aparece quando permitido e só no WhatsApp.

Códigos: 403 `adapter_disabled`; 503 `unavailable` também quando o template não pode ser verificado; 404 `not_found` (passo ou lead de outra organização é indistinguível de inexistente); 400 `wrong_channel`; 200 com `estado: ja_confirmado` e `next_action: none`; 503 `unavailable`.

Replay: negação gravada volta como está (`replay: true`), mesmo que o gateway agora permitisse. Permissão gravada é reavaliada ao vivo e pode virar negação. Replay nunca transforma negação em permissão.

#### 3.1.1 Validação do template no servidor

Com a flag ligada e `template` informado, antes de consultar o gateway o app lista os templates `APPROVED` da WABA da organização na Graph API (`GET /{business_account_id}/message_templates?status=APPROVED`, mesma versão e mesma credencial de `whatsapp_connections` que o envio atual usa; o token é decifrado só no servidor e nunca sai em resposta ou log).

- Aprovado: `template.id` igual ao id ou ao nome de um template APPROVED, no idioma pedido. Segue para o gateway.
- Não aprovado, inexistente ou idioma diferente: `allowed: false`, `reasons: ["template_not_approved"]`, `next_action: skip`. A negação é gravada na trilha e o replay da mesma chave continua negado, mesmo que a Meta aprove depois (use outra `idempotency_key`).
- Falha de leitura (Graph API fora, erro HTTP, resposta inválida, organização sem conexão WhatsApp ativa, lista maior que 5 páginas de 200): 503 `unavailable` com `retryable: true`. Nega (fail-closed), não grava a trilha e nada é enviado.
- Cache em memória de 60 segundos por organização e WABA; erro nunca é cacheado. Um template recém-pausado ou removido na Meta pode ser aceito por até 60 segundos; a Meta ainda recusa o envio na origem.
- Só roda com a flag `edge_command_adapter` ligada para a organização. Desligada, nenhuma chamada à Graph API é feita.
- Sem `template` no pedido, não há consulta. Se o gateway exigir template (primeiro contato ou fora da janela de 24h) e nenhum for informado, ele nega com `outside_service_window_requires_template`.

### 3.2 `POST /api/v1/edge/messages/result`

Registra o desfecho. Exige autorização prévia com a mesma `idempotency_key`.

```json
{ "workflow": "ana_whatsapp", "idempotency_key": "…", "execution_id": "<uuid>",
  "status": "enviado", "texto": "…", "message_id": "wamid…", "erro": "…" }
```

- `status`: `enviado`, `falhou`, `incerto` ou `nao_enviado`.
- WhatsApp `enviado`, `falhou`, `incerto`: delega ao handler atual `/bdr/steps/whatsapp` (`acao: registrar`), que registra no histórico e avança o passo.
- `nao_enviado`: avança o passo como pulado, usando a mesma RPC das rotas atuais (`confirm_email_step`).
- `ana_email`: só `nao_enviado` (o envio da cadência de e-mail sai pelo app, ver 3.3).
- `ana_email_agent`: grava apenas a trilha. O histórico do agente continua sendo gravado pelo fluxo atual.
- 409 `not_authorized` (sem autorização) e 409 `authorization_denied` (gateway negou; só `nao_enviado` é aceito).
- O registro de algo que já saiu não expira: não há validade de autorização que bloqueie o `result`.
- Replay devolve o resultado gravado (`replay: true`) sem delegar de novo.

### 3.3 `POST /api/v1/edge/messages/email-send`

Para `ana_email`. O app envia pela caixa da Ana (mesmo handler de `/bdr/steps/email`, sem alterá-lo), depois de **revalidar o gateway imediatamente antes do envio**.

```json
{ "idempotency_key": "…", "execution_id": "<uuid>", "remetente_email": "…", "assunto": "…", "corpo": "…" }
```

- 409 `not_authorized`, `authorization_denied`, `gateway_denied` (com `reasons`).
- Resultado terminal (`enviado`, `falhou`, `incerto`, `nao_enviado` por bloqueio) é gravado; replay não reenvia. `caixa_indisponivel` e `teto_caixa` não gravam estado terminal (o passo volta).
- Mantém as garantias do handler atual: intenção antes do envio e envio incerto nunca reenviado.

### 3.4 `POST /api/v1/edge/replies/route`

Roteador de respostas do WhatsApp.

```json
{ "idempotency_key": "…", "phone": "…", "message_id": "…", "texto": "…", "opt_out": false }
```

O app localiza o lead pela organização da chave, registra a resposta pelo handler atual (`acao: resposta`: hold de prospecção, ou total se pediu para parar, idempotente por `message_id`) e devolve quem responde:

| `route` | Significado |
|---|---|
| `ai` | Pode seguir a IA (dono automático ou sem dono, sem bloqueio) |
| `human` | Um humano decide (hold de conversa, modo não automático, ownership desligado, falha de leitura, telefone ambíguo) |
| `none` | Hold total ou opt-out: ninguém responde |
| `unknown` | Telefone sem lead nesta organização |

Telefone com mais de um lead: não associa a resposta, devolve `human`; só o pedido de parar vale para todos os leads encontrados.

## 4. Como ativar (ação separada, não feita neste PR)

1. Inserir a linha da flag (este PR não tem migration): `INSERT INTO app_flags (key, enabled, note) VALUES ('edge_command_adapter', false, 'PR13: adaptadores n8n') ON CONFLICT (key) DO NOTHING;`
2. Pré-requisitos por organização: `conversation_ownership_v1` e o gateway ligados (sem ownership o gateway nega e o roteador devolve `human`).
3. Cortar por organização com `allow_org_ids`, como no runbook `motor-contato-piloto.md`. Pausa: remover a organização de `allow_org_ids`. Pausar não reabre caminho sem gateway.
4. Só então aplicar os diffs abaixo, um workflow por vez, com aprovação.

## 5. Diff proposto por workflow (não aplicado)

Em todos: manter o caminho atual como está até a flag ligar; o novo caminho entra como ramo condicionado, para a organização do piloto. Se uma chamada nova falhar com 5xx, **não enviar** e devolver o passo (`/bdr/steps/release`).

### 5.1 Ana BDR: WhatsApp da cadência

Hoje: `claim` → `checar` → IA escreve → `iniciar` → envia (Meta, template) → `registrar`.

Proposta:

1. Depois de `checar` (regras de sinal e teto continuam valendo) e antes de `iniciar`: `POST /edge/messages/authorize` com `workflow: ana_whatsapp`.
2. `allowed: true`: usar `to` e `template_id` devolvidos (não o telefone do próprio fluxo). Seguir `iniciar` → envio → `POST /edge/messages/result` (`enviado`, `falhou` ou `incerto`) no lugar do `registrar`.
3. `next_action: skip`: `result` com `nao_enviado`. `next_action: release`: `/bdr/steps/release`.
4. Remover do fluxo qualquer escolha própria de número ou provedor.

### 5.2 Ana BDR: e-mail da cadência

Hoje: `claim` → IA escreve → `/bdr/steps/email` (o app envia).

Proposta: antes do envio, `authorize` (`ana_email`); permitido, trocar a chamada para `POST /edge/messages/email-send` (mesmos campos mais `idempotency_key`). `skip`: `result` com `nao_enviado`. `release`: `/bdr/steps/release`.

### 5.3 Ana BDR: agente de e-mail (respostas)

Hoje: reserva de conversa e resposta; consistência com holds a confirmar (seção 8 do plano).

Proposta: antes de cada resposta, `authorize` com `workflow: ana_email_agent` e `lead_id`; só responder com `next_action: send`. Depois, `result` (`enviado`, `falhou`, `incerto`) para a trilha. O histórico continua sendo gravado como hoje. Hold ou dono humano passam a bloquear a resposta automática.

### 5.4 Ana BDR: roteador de respostas

Hoje: usa tabela auxiliar de roteamento por telefone.

Proposta: ao receber uma resposta, `POST /edge/replies/route` com o telefone e o `message_id` da Meta. Rotear pelo `route` devolvido (`ai` segue para o agente, `human` notifica o responsável, `none` e `unknown` encerram). A tabela auxiliar deixa de ser a fonte da identidade (centralização no CRM, seção 8 do plano), mas só deve ser removida em mudança separada.

## 6. Decisões de projeto e limites

- **Sem outbox neste PR.** Enfileirar na `send_outbox` faria o dispatcher reservar a mesma ação (`claim_send` pega qualquer entrada `pending`), criando dois emissores da etapa. A chave comercial e a trilha de auditoria vêm do `decision_events`. A integração com a outbox exige um marcador de transporte externo na RPC, o que seria migration.
- **O gateway é obrigatório quando a flag está ligada**, independentemente de `send_gateway_shadow` e `send_gateway_enforced`: ligar o adaptador para uma organização é o aceite de que a decisão vale.
- **Consentimento:** o gateway nega primeiro contato de WhatsApp sem opt-in registrado (`no_consent`). Quem liga o piloto precisa ter evidência de consentimento carregada, ou o WhatsApp da cadência será negado.
- **Template:** a decisão de aprovar é do app, via Graph API, não de allowlist. Não foi criada tabela nem migration; a credencial já existe em `whatsapp_connections`. Cada instância do app mantém o próprio cache de 60 segundos.
- Os eventos `signal_observed` com `model_version = edge_command_v1` aparecem na contagem do painel `/settings/motor-contato`.
- Não cobre: Ana V4, ingestão (PR14), executor phone, fila Evolution, admissão Apollo.
