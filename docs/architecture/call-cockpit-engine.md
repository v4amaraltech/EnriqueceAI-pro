# Motor de contato e cockpit de ligação: contratos e decisão arquitetural

Status: proposta (PR01). Somente documentação e tipos. Nenhuma migration, nenhuma rota, nenhuma mudança de comportamento.

Origem: plano "CRM onde o time só liga", árvore `main` em `2424fe8`. Tipos correspondentes em `src/features/contact-engine/types.ts` (sem runtime, não importado por nenhum módulo).

Código presente não comprova implantação, configuração ou funcionamento em produção. Tudo abaixo vem de leitura estática do repositório e do plano.

## 1. Decisão arquitetural

1. O motor de contato vive dentro do aplicativo EnriqueceAI-pro. O Supabase (PostgreSQL) é a fonte de verdade.
2. Gateway de decisão, outbox, ownership, consentimento, supressão, aquecimento, tetos por número, saúde, auto-pausa e distribuição de leads são responsabilidade do aplicativo.
3. O n8n fica nas bordas: webhooks de entrada, enriquecimento, chamadas a APIs externas e gatilhos simples. O n8n nunca decide destinatário, canal, número, consentimento ou retry, e nunca envia mensagem fora do gateway.
4. Fronteira de execução: o aplicativo autoriza e registra cada ação e mantém o estado transacional. Adaptadores externos só executam comandos autorizados, com identidade, prazo e payload fixados, e devolvem o resultado.
5. Desligar uma flag de segurança pausa envios. Nunca restaura um caminho sem gateway.

## 2. Política de WhatsApp: oficial e Evolution

| Situação | Canal | Regra obrigatória |
|----------|-------|-------------------|
| Primeiro contato comercial sem conversa anterior | Cloud API oficial (Meta), template aprovado | Somente com opt-in comprovado para WhatsApp e finalidade compatível. Lead frio sem permissão não recebe WhatsApp; a permissão é buscada por outro canal adequado |
| Lead respondeu no número oficial | Cloud API por padrão | Resposta livre na janela de 24h; fora dela, template aprovado. Não mover automaticamente para outro número |
| Lead pediu contato do SDR ou há conversa esperada com o número dele | Evolution, opcional | Evidência de pedido ou resposta pertinente e consentimento para a continuidade, após validação de termos e autorização. Responder a um número não concede permissão genérica para abordagem por outro |
| Lead pediu para parar, sessão caiu ou número foi restringido | Nenhum envio automático | Supressão ou pausa conforme o motivo. Nunca fallback para outro número, canal ou provedor para insistir |

Princípios:

- Evolution não é equivalente à Cloud API e pode envolver risco contratual e de bloqueio mesmo com baixo volume. Preferir a continuidade oficial quando não houver necessidade real de outro canal.
- Evolution serve apenas para continuidade autorizada. Não é canal de primeiro contato frio.
- Proibido criar, trocar, reciclar ou rotacionar números para evadir banimentos, bloqueios, restrições ou controles do WhatsApp. Capacidade esgotada mantém a fila aguardando ou gera alerta, sem redistribuir para outro número para ultrapassar o teto.
- Aquecimento e pacing existem para proteger a operação e respeitar o destinatário. Não legitimam spam nem garantem imunidade a bloqueio.
- Telemetria ausente é "desconhecida" (`HealthSignal` com `known: false`), nunca ausência de risco. Falha de sessão, restrição ou denúncia confiável pausa imediatamente.
- Simples abertura de e-mail não conta como autorização de WhatsApp para a fila Evolution.

Lacuna atual registrada na leitura do plano: a fila Evolution (`whatsapp-auto-send`) aceita contatos sem resposta anterior; resposta anterior só muda a contagem do teto. O gate de elegibilidade por pedido ou resposta e consentimento é trabalho de PR06 e PR10.

## 3. Ownership, consentimento e opt-out

### 3.1 Ownership de conversa (proposto, PR05)

Registro canônico por organização e contato ou lead: `owner_user_id`, `automation_mode`, `provider`, `sender_instance_id`, `consent_scope`, `version`. Tipo: `ConversationOwnership`.

- Responsável comercial é distinto de quem está autorizado a falar.
- Claim e transferência são atômicos, por compare-and-swap em `version`. Chegada de outro evento não transfere conversa.
- Usuário de outra organização é negado. O isolamento segue o padrão de RLS do repositório (`user_org_id()`, `is_manager()`).
- Nome da tabela (`conversation_ownership`) é proposta a validar no PR05.

### 3.2 Consentimento (proposto)

Evidência explícita (`ConsentEvidence`) com base (`ConsentBasis`), referência à interação de origem e data de captura e revogação. Sem evidência, WhatsApp não inicia conversa. Template aprovado não substitui opt-in. Template que pede consentimento não autoriza contato prévio.

### 3.3 Opt-out via contact-holds

`contact_holds` é a autoridade de supressão, com escopo claro:

- `total`: recusa ou pedido para parar. Nada mais sai (ligação, e-mail frio, conversa).
- `prospeccao`: lead respondeu ou reunião marcada. A cadência fria para; a conversa continua.
- `conversa`: humano assumiu. A IA não responde.

`total` implica as outras duas. Propostas para o motor: versão e trilha de origem no registro; pedido para parar bloqueia todos os números WhatsApp da organização e cancela outbox pendente; replicar para V4 Sales e n8n; revalidar imediatamente antes do envio. Bloqueio total alcança os demais canais comerciais e não se confunde com pausa só de prospecção.

## 4. Gateway, outbox e idempotência (contratos propostos)

### 4.1 Gateway de decisão (PR06)

Decide uma vez, antes de enviar. Entrada: `SendIntent`. Saída: `SendDecision` (permitido, com provedor, template e versão de ownership; ou negado, com `SendDenialReason[]`). Verifica consentimento, opt-out, responsável, resposta recente, canal permitido e saúde do número. A decisão não envia nada. Modos: `off`, `shadow` (compara sem enviar) e `enforced` (`GatewayMode`).

### 4.2 Outbox transacional (PR07 e PR08)

- Chave comercial única por organização, lead, inscrição e etapa, independente do provedor (`CommercialActionKey`, `OutboxEntry.idempotencyKey`). Dois workers não executam a mesma ação.
- Estados: `pending`, `claimed`, `sending`, `accepted`, `delivered`, `failed`, `uncertain`, `cancelled`.
- Intenção gravada antes do envio; aceitação confirmada com ID do provedor; entrega depois. Eventos append-only em `send_events`.
- Timeout vira `uncertain` e aguarda reconciliação. Sem retry cego, sem fallback para outro provedor, número ou canal. Claim expirado não prova que a mensagem não saiu.
- Consentimento, dono, pausa e supressão são revalidados no claim e imediatamente antes do envio.
- A garantia é deduplicação com tratamento explícito de incerteza, não promessa de exactly-once no provedor externo.
- Se o n8n fizer transporte, recebe só `AuthorizedSendCommand` (prazo e hash fixados), não modifica o payload e devolve `SendConfirmation`, idempotente por `outboxId` e resultado. Comando vencido ou com hash divergente é rejeitado.

Os padrões já existem em pequena escala no BDR (seção 6.2): `begin_email_step` grava a intenção, estado `ja_iniciado` vira envio incerto e nunca é reenviado.

## 5. Flags propostas

Todas nascem desligadas. Flags de restrição de segurança são fail-closed.

| Flag | Efeito | PR |
|------|--------|----|
| `call_cockpit_v1` | Leitura nova de contexto e cartão de ligação | PR02, PR03 |
| `call_cockpit_outcomes` | Consumo novo de resultado pós-ligação | PR04 |
| `conversation_ownership_v1` | Escrita de ownership e consentimento | PR05 |
| `send_gateway_shadow` | Gateway compara sem enviar | PR06 |
| `send_gateway_enforced` | Gateway obrigatório, por organização | PR06 |
| `send_outbox_enqueue` | Enfileirar na outbox, sem consumidor | PR07 |
| `dispatcher_v1` | Dispatcher e reconciliação, por organização | PR08 |
| `lead_assignment_shadow` | Distribuição simulada | PR09 |
| `number_health_v1` | Saúde e tetos por número | PR10 |
| `call_priority_v2` | Score e priorização novos | PR11 |
| `edge_command_adapter` | Adaptadores n8n de mensagens | PR13 |
| `edge_ingestion_v1` | Ingestão de borda (leads, ligações, enriquecimento) | PR14 |

Escopo atual de `app_flags`: a tabela tem apenas `key`, `enabled`, `note` e `updated_at` (ver `src/lib/supabase/types.ts`), ou seja, escopo global, sem `org_id`. O único uso lido no código é `inbound_recovery_enabled`, em `leads/services/inbound-recovery.service.ts`, que em erro assume desligado. O escopo por organização das flags acima precisa ser validado ou criado antes de qualquer corte; este PR não cria flag alguma.

## 6. Contratos existentes (lidos no código)

### 6.1 inbound-api (`src/features/inbound-api`)

Autenticação (`services/api-key-auth.ts`): chave em `Authorization: Bearer <key>` ou `?token=<key>`. A chave é convertida em hash e resolvida via service role; devolve `{ orgId, keyId }` ou `null`. Os escopos da chave ficam em `ApiKeyRow.scopes`. O parâmetro `token` em query string é aceito, o que merece revisão de segurança separada (aparece em logs de acesso).

`POST /api/v1/leads` (usa `ingestInboundLeads`):

- Corpo validado por `inboundLeadBatchSchema`: `leads` de 1 a 100 itens e `on_duplicate` (`skip` padrão ou `update`).
- Campos obrigatórios por lead: `first_name`, `email`, `telefone`, `empresa`. Opcionais incluem `cnpj`, `assigned_to` (uuid), `cadence_id` (uuid), `lead_source`, `canal`, `is_inbound` (padrão `true`), `custom_fields`.
- Limite: 100 requisições por minuto por organização (`inbound-api:<orgId>`). Corpo grande responde 413. Cabeçalho opcional `x-idempotency-key` (namespace `inbound-api`); repetição responde 200 "já processada".
- Plano: antes de inserir, confere `max_leads` da assinatura; excedido devolve erro por item.
- Deduplicação: por e-mail (comparação case-insensitive) ou CNPJ na organização, ignorando excluídos, e também dentro do mesmo lote. Corrida de inserção (`23505`) é resolvida como duplicado.
- Resultado por item (`InboundLeadResult`): `created`, `duplicate`, `updated` ou `error`, com `lead_id` ou `existing_lead_id`; com `cadence_id`, também `enrolled` e `enroll_error`. Agregado em `InboundBatchResult`. Em `update`, só telefone, empresa, cargo, linkedin, website e notas são atualizados.
- Efeitos colaterais: evento de timeline, disparo de webhook `lead.created` (sem aguardar), notificação ao SDR atribuído, inscrição em cadência se solicitada (só cadência ativa; a trigger `enforce_enrollment_has_owner` pode recusar sem `assigned_to`). Enriquecimento por CNPJ não é disparado nesse caminho.
- Este contrato não toca `contact_holds`: um lead reingressado por API não consulta supressão aqui. Ponto a tratar no gateway (PR06).

`GET /api/v1/leads` e `/api/v1/leads/[id]` (`read-leads.service.ts`): projeção pública curada (`PublicLead`, `nome_fantasia` exposto como `empresa`; campos internos como `fit_score` e `engagement_score` ficam de fora). Query: `page`, `per_page` (máx. 100, padrão 50), `status` (lista separada por vírgula), `updated_since` (ISO 8601 com offset), `lead_source`, `canal`. Ordenação por `created_at` decrescente; paginação por offset. Limite de 100 por minuto por organização (`api-read:<orgId>`). Nota: `LEAD_STATUS_VALUES` inclui `won`, valor que não consta na tabela de enums do `dev-checkpoints.md`; confirmar contra o enum real no banco antes de reutilizar.

### 6.2 bdr-steps (`src/features/bdr-steps` e rotas `/api/v1/bdr/*`)

Todas as rotas autenticam por API key e têm limite de taxa por organização. Escritas passam por RPCs do banco, chamadas via `callRpc` (`actions/rpc.ts`), que lança erro `"<fn>: <mensagem>"`.

| Rota | RPC | Contrato |
|------|-----|----------|
| `POST /bdr/steps/claim` | `claim_due_steps` | Corpo: `cadence_ids` (uuid[], obrigatório), `channel` (`phone` padrão; `phone`, `whatsapp`, `email`, `linkedin`, `research`), `limit` (1 a 100, padrão 10), `lease_minutes` (1 a 240, padrão 15), `owner`, `exige_abertura_email`. Devolve passos com `execution_id` persistente por inscrição, passo e tentativa. Reserva de novo (`recuperada`) mantém o mesmo `execution_id` |
| `POST /bdr/steps/renew` | `renew_step_lease` | Renova o lease |
| `POST /bdr/steps/release` | `release_step_claim` | Devolve o passo; por padrão a execução continua aberta e reaproveita o `execution_id`. `nova_tentativa=true` é decisão comercial explícita |
| `POST /bdr/steps/email` | `begin_email_step`, `confirm_email_step` | Corpo: `execution_id` (uuid, obrigatório fora do teste), `remetente_email`, `assunto` (máx. 150), `corpo` (máx. 4000); modo teste com `teste_para`. Códigos: 503 `caixa_indisponivel`, 404 `execution_id_desconhecida`, 409 `bloqueado`, 429 `teto_caixa`, 502 `envio_incerto` ou `envio_falhou`. `desfechoDoEnvio` classifica: `enviado`, `falhou_avanca`, `caixa_indisponivel` (nada saiu, devolve o passo) e `incerto` (registra e avança, nunca reenvia) |
| `POST /bdr/steps/whatsapp` | `begin_email_step`, `confirm_email_step` (reaproveitadas) | Ações `checar`, `iniciar`, `registrar`, `resposta`. Detalhado abaixo |
| Webhook de evento externo | `confirm_external_step` | Eventos terminais `chamada_finalizada`, `caixa_postal`, `chamada_falhou`; deduplica por `event_id`; só `execution_id_desconhecida` responde 404, duplicados e tardios respondem 200 (`httpStatusFor`) |
| `GET /bdr/leads/[id]/contexto` | n/d | Histórico curto para IA (`resumirHistorico`): ignora eventos `system`, aberturas e cliques; abertura só conta se houver `aberto_real_em` ou `clicado_real_em` gravado no envio |

WhatsApp da cadência (`whatsapp-step.ts` e rota): regras de 15/10/2026 no código.

- Decisão `decidirWhatsApp`, nesta ordem de recusa: bloqueio de qualquer tipo, recusa na ligação (`nao_contatar`), descadastro por e-mail suprimido, lead perdido, limite de 3 por lead (`MAX_WHATSAPP_POR_LEAD`), WhatsApp inválido, sem celular. Só então exige um sinal: autorizou na ligação, respondeu e-mail ou 2 ou mais aberturas reais (`MIN_ABERTURAS_EMAIL`). Sem sinal, `sem_sinal`.
- Só celular brasileiro (`celularBr`); teto diário `MAX_WHATSAPP_POR_DIA = 15` por organização, contado desde 00:00 de Brasília; atingido responde 429 `teto_do_dia` sem registrar nada.
- `iniciar` grava a intenção antes do envio. Se já havia tentativa iniciada, registra incerto e responde 409 `envio_incerto`: não enviar.
- `registrar` aceita `enviado`, `falhou` ou `incerto` e avança o passo.
- `resposta`: grava hold `prospeccao` (origem `whatsapp_respondeu`) ou `total` (origem `whatsapp_pediu_para_parar`) via upsert em `(lead_id, tipo)`; idempotente por `message_id`. Pedido de parar vem de `opt_out: true` ou de `pedidoParaParar` aplicado ao texto.
- O envio em si é do n8n. A rota decide, trava e registra.
- Observação: a decisão consulta holds apenas por `lead_id` e não valida opt-in formal de WhatsApp; o sinal é comportamental. O plano trata isso como lacuna (opt-in comprovado) a fechar no gateway.

### 6.3 contact-holds (`src/features/contact-holds` e `GET /api/v1/contacts/holds`)

- Serviço puro `hold-flags.ts`: `resolveHoldFlags(holds)` devolve três booleanos sempre presentes (`bloqueado_total`, `bloqueado_prospeccao`, `bloqueado_conversa`); `total` implica os outros dois. `phoneDigits` mantém só dígitos; `isQueryablePhone` exige de 10 a 14 dígitos.
- Rota: `?telefone=` obrigatório; localiza leads da organização por RPC `find_lead_ids_by_phone` e lê `contact_holds` (`lead_id`, `tipo`, `origem`, `created_at`). Resposta: `success`, `telefone`, `encontrado`, `lead_ids`, as três flags e `holds`. Telefone sem lead: `encontrado=false` e tudo `false`.
- Falha de leitura responde 5xx de propósito, para o consumidor (V4 Call) tratar como fonte indisponível e aguardar, nunca liberar. Esse comportamento fail-closed é o modelo para o gateway.
- Limite de 600 requisições por minuto por organização; `Cache-Control: no-store`.
- Escrita: os holds são gravados pela rota de WhatsApp (acima) e por outros caminhos fora do escopo deste PR. Não foi inventariada aqui a lista completa de escritores.

## 7. Cutover em fases (atual segue funcionando)

Regra geral: nenhum PR remove cockpit, cadências, executores n8n ou filas atuais. Cada PR compila isolado, com comportamento novo desligado. Migrations só aditivas; schema primeiro, consumidores depois. Deploy e ativação são separados de merge. Nunca dois emissores da mesma etapa.

1. Fase 0 (PR01): contratos, tipos e esta documentação.
2. Fase 1 (PR02 a PR04): cockpit de ligação sobre cockpit, API4Com e transcrição existentes, atrás de `call_cockpit_v1`. Desligar a flag volta à tela anterior. Não inicia ligações nem altera cadências.
3. Fase 2 (PR05 a PR08): ownership, gateway em modo `shadow` (compara, não envia), outbox sem consumidor, depois dispatcher por organização. Após o corte de uma organização, desligar pausa envios; não reabre o caminho antigo.
4. Fase 3 (PR09 a PR11): distribuição dentro do app (simulação antes de enforce), saúde e tetos por número, score novo em shadow.
5. Fase 4 (PR12 a PR14): piloto com 1 SDR e 1 closer, runbook de pausa e rollback, adaptadores n8n versionados. Edição ou ativação de workflow é ação separada e aprovada. Admissão Apollo e reativação CRM Evolution seguem inativas até aprovação.

Rollback nunca é permissão de bypass.

## 8. Inventário resumido de emissores ativos

Fonte: auditoria estática do plano em 07/11/2026 (seção "4.1 Auditoria n8n e distribuição") mais leitura do código deste repositório. O plano não traz uma seção com o título "Inventário de emissores ativos"; este resumo consolida o que ali está sobre quem envia ou dispara contato. Estado "ativo" indica configuração, não sucesso ou saúde operacional.

Ressalva de cobertura: 95 workflows n8n ativos não puderam ser lidos. Esta lista é, portanto, parcial e pode omitir emissores. Para referência, o plano registra listagem dos 200 workflows mais recentes de um total informado de 369 e leitura de 16 definições completas; o workflow base "Enriquece AI" teve a definição recusada pelo conector MCP. Não se deve afirmar que não existem outros emissores.

| Emissor | Estado observado | Canal | Passa pelo app? |
|---------|------------------|-------|-----------------|
| Ana BDR: WhatsApp da cadência | Ativo | WhatsApp Meta oficial, com template | Decide e registra via `/bdr/steps/whatsapp`; envio é do n8n |
| Ana BDR: e-mail da cadência | Ativo | E-mail via Gmail do Enriquece | Claim, envio e confirmação via `/bdr/steps/*` |
| Ana BDR: agente de e-mail | Ativo | E-mail (respostas) | Reserva de conversa; consistência com holds a confirmar |
| Ana BDR: executor phone | Ativo | Ligação (V4 Call) | Claim e confirmação via `/bdr/steps/*` |
| Ana BDR: roteador de respostas | Ativo | WhatsApp (entrada) | Usa tabela auxiliar de roteamento; a identidade deve ser centralizada no CRM |
| Ana V4: consentimento e respostas | Ativos (2 fluxos) | WhatsApp, em V4 Sales | Supressão a conciliar com o Enriquece |
| LeadBroker Enriquece AI Sync v2 | Ativo | Ingestão de leads | Via API de leads; responsável fixo por origem |
| Enriquecimento em lote | Ativo | Enriquecimento diário | Destino não validado (definição base indisponível) |
| API4Com e Callface para Enriquece | Ativos (2 fluxos) | Webhooks de ligação | Risco de duplicidade por provedor e ID externo |
| V4 Flux e Enriquece | Ativos (3 fluxos) | Sincronização de calls e leads | Fonte de verdade a definir |
| Ana BDR: admissão Apollo | Inativo | Aquisição | Não ativar sem aprovação |
| Reativação CRM Evolution | Inativo | WhatsApp Evolution | Não ativar |
| Fila `whatsapp-auto-send` (no app) | Código presente | WhatsApp Evolution | Roda no app; aceita contatos sem resposta anterior |
| Cadências no app (`execute-cadence.ts`) | Código presente | E-mail automático; outros canais manuais | Roda no app |

Fluxos de outros clientes e versões legadas não foram auditados.

## 10. Dispatcher e reconciliação (PR08)

Status: implementado atrás da flag `dispatcher_v1` (global em `app_flags`, nasce desligada). A rota de cron existe mas **não está agendada**.

### 10.1 Peças

| Peça | Arquivo | Papel |
|------|---------|-------|
| Dispatcher | `contact-engine/services/dispatcher.service.ts` | `claim_send`, revalidação (comando, hash, gateway, holds e opt-out), `sending`, provedor, `confirm_send` |
| Adaptadores | `contact-engine/services/provider-adapters.service.ts` | Composição sobre `WhatsAppService`, `EvolutionWhatsAppService` e `EmailService`, sem alterá-los |
| Reconciliação | `contact-engine/services/reconciliation.service.ts` | Resolve `uncertain` e `sending` com lease vencido; aplica callbacks por `external_id` |
| Ciclo | `contact-engine/services/dispatch-cycle.service.ts` | Por organização com trabalho: despacha e reconcilia |
| Rota | `app/api/cron/dispatch-send-outbox/route.ts` | `POST`, protegida por `verifyCronSecret` |
| Migration | `20261107180000_dispatcher_reconciliation.sql` | Status `delivered`, eventos novos, RPC `reconcile_send`, flag |

### 10.2 Regras

- Uma autoridade de execução por ação: chave comercial única, lease exclusivo e CAS por `version`.
- Antes de enviar: comando não vencido, hash do payload confere, gateway permite de novo com o **mesmo** provedor e instância, e `confirm_send(sending)` revalida holds e opt-out no banco. Divergência cancela; nunca troca de caminho.
- Timeout, exceção ou resposta ambígua depois da chamada ao provedor viram `uncertain`. Sem reenvio cego, sem fallback de provedor, número ou canal, sem rotação.
- Classificação dos adaptadores: `accepted` (id do provedor), `rejected` (garantidamente nada saiu) ou `ambiguous` (qualquer outra coisa). A lista de mensagens "nada saiu" é fechada; texto desconhecido nunca vira `rejected`.
- Retry só quando o adaptador consulta o provedor e ele confirma que não houve aceitação, depois de 10 minutos (consistência eventual) e com nova autorização do gateway. Hoje só o e-mail consulta (Gmail, por `rfc822msgid` com Message-ID determinístico por entrada). WhatsApp oficial e Evolution ficam `uncertain` até um callback com o id ou ação manual.
- Callbacks (`applyProviderEvent`) são idempotentes e tolerantes a ordem: o estado nunca regride (`delivered` não volta a `sent`), repetição devolve `noop`, id desconhecido devolve `unmatched` para o chamador tentar de novo. Nenhuma rota de webhook chama essa função neste PR.
- Logs com ids e motivos apenas.

### 10.3 O que falta para enviar de verdade

A outbox guarda só o hash do payload. O dispatcher precisa de um `PayloadResolver` (corpo, assunto, ator que autorizou, dono da caixa de e-mail), que é de quem enfileira. Hoje `getPayloadResolver()` em `dispatch-cycle.service.ts` devolve `null`: com a flag ligada o ciclo responde `payload_resolver_not_configured` e não reserva nada.

### 10.4 Como ativar (ação separada, não feita neste PR)

1. Aplicar a migration `20261107180000` e regenerar os tipos (`pnpm gen:types`).
2. Registrar o `PayloadResolver` real e revisar a política de classificação dos adaptadores.
3. Ligar `send_outbox_enqueue` e `dispatcher_v1` em `app_flags` (escopo global; ver a ressalva na seção 5).
4. Agendar o cron fora de migration, clonando o comando de um job existente, como a migration `20261106223900` faz:

```sql
SELECT cron.schedule(
  'dispatch-send-outbox',
  '* * * * *',
  replace(
    (SELECT command FROM cron.job WHERE jobname = 'execute-cadence-steps'),
    '/api/cron/execute-cadence-steps',
    '/api/cron/dispatch-send-outbox'
  )
);
```

Pausar: `UPDATE app_flags SET enabled = false WHERE key = 'dispatcher_v1';` (a rota passa a responder sem ler a fila). Nunca reabre um caminho sem gateway.

## 11. Distribuição de leads (PR09)

Status: implementado atrás de `lead_assignment_shadow` e `lead_assignment_enforced` (globais em `app_flags`, nascem desligadas). Nenhum chamador grava atribuição neste PR.

- Serviço: `contact-engine/services/lead-assignment.service.ts`. Reusa `pickLeastLoadedSdr` e `countOpenEnrollmentsBySdr` do recovery.
- Migration `20261107190000`: `lead_assignment_policies` (capacidade padrão, cursor e `cursor_version`), `lead_assignment_members` (elegíveis, capacidade própria, posição), RPC `assign_lead_by_policy` (trava a política, CAS no cursor), RLS por org, escrita só `service_role`.
- Ordem de decisão: `assigned_to` > `pending_assigned_to` > dono de conversa ativa (PR05) > política (menor carga; empate no anel `(position, user_id)` a partir do cursor).
- Shadow: calcula e escreve log estruturado `lead_assignment_shadow` (ids e motivos, sem PII). Não grava nada nem avança o cursor. Pontos inertes: `inbound-lead.service.ts` e `bulk-assign-leads.ts`.
- Enforced: `assignLeadByPolicy` só atribui lead sem dono, sem pendência e sem conversa; reavalia até 3 vezes em `cursor_conflict`.
- Não faz: reatribuição em massa, mudança do rodízio do recovery, leitura ou escrita de números, instâncias ou provedores.
- Ativação (ação separada): aplicar a migration, rodar `pnpm gen:types`, popular política e membros, ligar o shadow e comparar os logs antes de qualquer uso do enforced.

## 13. Score de prioridade v2 e feedback de ligações (PR11)

Status: implementado atrás de `call_priority_v2` (global em `app_flags`, nasce desligada). Nenhum envio, cadência ou workflow é alterado.

### 13.1 Peças

| Peça | Arquivo | Papel |
|------|---------|-------|
| Score puro | `contact-engine/services/call-priority.ts` | `computeCallPriority`, `rankLeadsByPriority`; sem I/O |
| Serviço | `contact-engine/services/call-priority.service.ts` | Flag, carga de sinais por organização, trilha `decision_events`, correção humana |
| Cockpit | `cockpit/services/next-call-card.service.ts`, `cockpit/utils/call-approach.ts` | Escolha do lead e abordagem v2, fonte e versão no cartão |
| Action | `cockpit/actions/call-priority.ts` | Correção humana de interesse |
| Migration | `20261107210000_call_priority_v2.sql` | `decision_events` append-only, RLS por organização, flag |

### 13.2 Regras do score

- `score = interesse * 10 + esforço`, com esforço entre 0 e 9. Qualquer interesse positivo vale mais que todo o esforço possível: sinal de envio nunca vence resposta explícita. Resposta explícita tem ainda um piso próprio.
- Interesse (0 a 100) vem de resposta explícita, reunião marcada, resultado de ligação informado pelo SDR, classificação da transcrição pela IA e BANT (campos B, A, N, T preenchidos). Esforço reusa `calculateEngagementScore` só com enviado, entregue, aberto, clicado, erro e falha.
- Idempotência: cada sinal tem chave; chave repetida conta uma vez. Cada ligação tem no máximo um resultado efetivo por autor; o do SDR prevalece sobre o da IA. BANT não soma entre repetições.
- Transcrição ausente, com confiança abaixo de 0,7, marcada para revisão, com falha ou com classificação desconhecida não soma nem subtrai, e aparece em `missing` ou `ignored`.
- `calls.sdr_disposition` igual à disposição da IA já aplicada é atribuída à IA (o `applyAiCallOutcome` grava a da IA nesse campo quando o SDR não marcou nada); só divergente conta como resultado humano.
- Correção humana: a mais recente substitui o interesse calculado (0 a 100); o esforço continua. Os sinais substituídos ficam em `ignored`. A correção é um evento novo, nunca edição.
- Sem autoajuste de prompt e sem alteração de política comercial: tudo é regra fixa e determinística.

### 13.3 Trilha `decision_events`

Append-only (mesmo gatilho do PR05), única por `(org_id, idempotency_key)`, com `model_version`, `source`, `event_type` e `payload` restrito a chaves permitidas (ids, códigos, números; sem telefone, e-mail, nome, transcrição ou texto de mensagem). Escrita só `service_role`; `authenticated` lê a própria organização. O cliente de service role ignora RLS, então toda consulta do serviço filtra `org_id` de forma explícita.

### 13.4 Comportamento por flag

- Desligada: o cockpit usa `pickNextLead` e `suggestApproach` v0 exatamente como antes; nada de `decision_events` é lido ou escrito.
- Ligada: o score v2 escolhe o lead entre os candidatos de sempre (mesma carteira e mesmos bloqueios), a abordagem vira `v2` (a v0 mais pontos com a fonte) e o cartão mostra fonte, versão e pontuação. A sugestão é gravada em `decision_events` com `v1_pick_same` para comparar com a regra anterior. Falha de leitura de qualquer sinal mantém a escolha anterior.
- Desligar de novo volta à ordem anterior; os eventos já gravados permanecem.

### 13.5 Ativação (ação separada, não feita neste PR)

Aplicar a migration, rodar `pnpm gen:types`, revisar os eventos `priority_suggestion` com `v1_pick_same = false` e só então ligar a flag.

## 9. Fora do escopo do PR01

Migrations, tabelas, rotas, adaptadores, edição ou ativação de workflows, regeneração de `types.ts` do Supabase (não há mudança de schema), qualquer envio de mensagem. Nenhum segredo, credencial ou dado real consta neste documento ou nos tipos.
