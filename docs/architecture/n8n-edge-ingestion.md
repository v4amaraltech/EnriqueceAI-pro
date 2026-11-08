# Adaptadores de borda do n8n para ingestão: LeadBroker, API4Com e enriquecimento (PR14)

Status: implementado no app atrás da flag `edge_ingestion_v1` (escopo por organização via `flag-scope.service.ts`, nasce desligada, **sem migration**). **Nenhum workflow n8n foi lido, editado ou ativado por este PR.** As definições reais dos workflows não estão no repositório; antes de aplicar qualquer mudança, o responsável deve conferi-las no n8n.

## 1. Princípio

O n8n traz o dado de fora e entrega ao app. Quem decide responsável, cadência, status, consentimento e o que pode ser sobrescrito é o app. Campos desconhecidos são rejeitados (400).

Com a flag desligada, as três rotas respondem 403 `adapter_disabled` sem ler nem gravar dado. `/api/v1/leads`, `/api/webhooks/api4com` e os fluxos atuais seguem exatamente como hoje (este PR não altera nenhum deles).

## 2. Convenções

- `contract_version: "edge-ingestion.v1"` em toda resposta de `/api/v1/edge/*` deste PR. Mudança incompatível entra em rota nova.
- Autenticação, API key da organização (`Authorization: Bearer`), e rate limit de 120 por minuto por organização e rota, iguais ao PR13. Corpo máximo de 1 MB.
- `idempotency_key`: 8 a 100 caracteres (`A-Z a-z 0-9 . _ : -`). A chave gravada é escopada por organização e operação (hash SHA-256), nunca colide entre organizações.
- Falhas retentáveis: 503 com `retryable: true`. Falha de leitura nunca é tratada como "não existe".
- Sem PII em log ou trilha: só ids, códigos e nomes de campo.

## 3. Endpoints

### 3.1 `POST /api/v1/edge/leads/ingest` (LeadBroker)

```json
{ "source": "leadbroker", "idempotency_key": "…", "leads": [ { "first_name": "…", "email": "…", "telefone": "…", "empresa": "…", "cnpj": "…" } ] }
```

- Usa o mesmo serviço de `/api/v1/leads` (`ingestInboundLeads`): limite do plano, deduplicação por e-mail e CNPJ, timeline, webhook `lead.created`.
- `on_duplicate` fixo em `skip`. O lead nunca é atualizado por esta rota.
- **Rejeitados (400):** `assigned_to`, `cadence_id`, `consent_whatsapp`, `lead_source`, `is_inbound`. O responsável vem da distribuição do app (PR09), o consentimento vem de `/api/v1/edge/consent`, e a origem é fixada pelo `source`.
- Replay de lote concluído sem erro devolve `replay: true` sem ingerir de novo. Lote com erro por item não é marcado: reenviar a mesma chave é seguro, porque duplicados são ignorados. Resposta traz `next_action`: `none` ou `retry_failed`.

### 3.2 `POST /api/v1/edge/calls/lookup` (API4Com e Callface)

```json
{ "provider": "api4com", "idempotency_key": "…", "external_call_id": "…" }
```

Só consulta, não cria ligação. Procura em `calls` da organização pelo id externo (e por `alt_api4com_ids` no API4Com).

- `known: true`, `next_action: skip`: o app já tem a ligação; o n8n não deve entregá-la de novo.
- `known: false`, `next_action: forward`: o n8n segue entregando ao webhook atual do app, como hoje.
- Erro de leitura: 503 (nunca "desconhecida", para não gerar duplicidade).

Limite conhecido: a consulta reduz a duplicidade por provedor e id externo, mas não elimina a corrida entre dois eventos simultâneos do mesmo id. A proteção definitiva continua na idempotência do webhook (`webhook_events`).

### 3.3 `POST /api/v1/edge/enrichment/result`

```json
{ "lead_id": "<uuid>", "idempotency_key": "…", "provider": "…", "status": "enriched", "fields": { "razao_social": "…", "porte": "…" } }
```

- `status`: `enriched` (exige `fields`), `not_found` ou `failed` (sem `fields`).
- Campos aceitos: `razao_social`, `nome_fantasia`, `porte`, `cnae`, `segmento`, `situacao_cadastral`, `faturamento_estimado`, `website`, `linkedin`, `instagram`, `cnpj`. **Telefone, e-mail, responsável e status do lead não são aceitos.**
- O app **só preenche campos vazios**; nunca sobrescreve. `cnpj` só entra se o lead não tem CNPJ e nenhum outro lead da organização usa o mesmo. A resposta lista `applied` e `skipped` (por exemplo `porte_already_set`, `cnpj_in_use`).
- `not_found` e `failed` atualizam `enrichment_status`, mas nunca rebaixam um lead já `enriched`. Cada tentativa vai para `enrichment_attempts`.
- Lead de outra organização é indistinguível de inexistente (404).
- Idempotência em `decision_events` (`signal_observed`, `model_version = edge_ingestion_v1`), com só os nomes dos campos aplicados. A trilha é gravada depois da escrita; como a escrita só preenche vazios, repetir é seguro.

## 4. Como ativar (ação separada, não feita neste PR)

1. Inserir a linha da flag (sem migration): `INSERT INTO app_flags (key, enabled, note) VALUES ('edge_ingestion_v1', false, 'PR14: ingestão de borda n8n') ON CONFLICT (key) DO NOTHING;`
2. Cortar por organização com `allow_org_ids`, como no runbook `motor-contato-piloto.md`. Pausa: remover a organização de `allow_org_ids`.
3. Criar ou reaproveitar uma API key da organização para o n8n.
4. Só então aplicar o checklist de mudanças do n8n abaixo, um workflow por vez, com aprovação.

## 5. O que o n8n precisará mudar depois (não aplicado)

Em todos: manter o caminho atual até a flag ligar; o novo caminho entra como ramo condicionado à organização do piloto.

- [ ] **LeadBroker Enriquece AI Sync v2:** trocar `POST /api/v1/leads` por `POST /api/v1/edge/leads/ingest`, com `source: "leadbroker"` e uma `idempotency_key` por lote (sugestão: `leadbroker:<id do lote ou janela>`). Remover `assigned_to` fixo por origem, `cadence_id`, `consent_whatsapp`, `lead_source` e `is_inbound` do corpo. Tratar `next_action: retry_failed` reenviando a mesma chave.
- [ ] **API4Com e Callface para Enriquece (2 fluxos):** antes de entregar o evento ao webhook, chamar `POST /api/v1/edge/calls/lookup` com `provider` e `external_call_id`; `skip` encerra, `forward` segue como hoje, 503 deve aguardar e tentar de novo (não entregar).
- [ ] **Enriquecimento em lote (e base "Enriquece AI"):** trocar a escrita direta no destino por `POST /api/v1/edge/enrichment/result` por lead, enviando só os campos aceitos. Conferir antes o destino atual, que o plano registra como não validado, e remover qualquer escrita de telefone, e-mail ou responsável.
- [ ] **V4 Flux e Enriquece (3 fluxos):** a fonte de verdade ainda está em aberto no plano. Não migrar sem decisão separada.
- [ ] Tratar 403 `adapter_disabled` como "usar o caminho antigo" e 5xx como "tentar depois, sem fallback que grave por fora do app".
- [ ] Guardar a chave de API em credencial do n8n, nunca em nó de código nem em log.

## 6. Limites

- Não cria ligações, não dispara transcrição, não inscreve em cadência, não envia mensagem.
- Não cobre Ana V4, admissão Apollo nem reativação CRM Evolution.
- Os eventos `signal_observed` com `model_version = edge_ingestion_v1` ficam na trilha de `decision_events`.
