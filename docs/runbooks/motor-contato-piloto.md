# Runbook: piloto do motor de contato (1 SDR e 1 closer)

Escopo: PR12 do plano `docs/architecture/call-cockpit-engine.md` (Fase 4, parte 1). Cobre corte por organização, pausa, rollback e verificação.

Este runbook não liga nada. Ligar o piloto, agendar o cron do dispatcher e editar workflows n8n são ações separadas, aprovadas e registradas fora deste PR. Nenhum comando abaixo contém segredo; substitua `<ORG_ID>`, `<SDR_ID>` e `<CLOSER_ID>` pelos ids reais no momento da execução.

## 1. Princípio

Rollback nunca é bypass. Pausar o piloto para envios e volta o cockpit à tela anterior. Não existe passo neste runbook que reabra um caminho sem gateway, sem dono de conversa, sem supressão ou sem saúde de número. Quem está sem o motor continua nos fluxos atuais (cadências, n8n), que este PR não altera.

## 2. Como funciona o corte (resumo)

Fonte: `src/features/contact-engine/services/flag-scope.service.ts`.

| Situação em `app_flags` | Resultado |
|---|---|
| `enabled = true` | Ligada para todas as organizações (comportamento global de sempre) |
| `enabled = false`, `allow_org_ids` contém a organização | Ligada só para ela |
| `enabled = false`, listas vazias | Desligada. Idêntico ao comportamento anterior ao PR12 |
| `allow_user_ids` preenchida | Estreita só os caminhos que carregam usuário (cockpit, prioridade, ownership, distribuição). Caminhos de organização (outbox, dispatcher, saúde de número) seguem o corte da organização |
| Usuário listado em organização fora de `allow_org_ids` | Nunca liga |

Atenção: desligar `enabled` NÃO desliga uma organização que está em `allow_org_ids`. A pausa precisa limpar a lista (passos abaixo).

Sem as colunas (migration `20261108100000` não aplicada), a leitura cai para o escopo global e nada muda.

## 3. Pré-requisitos do piloto (verificar, não executar aqui)

1. Migration `20261108100000_app_flags_scope.sql` aplicada e `pnpm gen:types` rodado.
2. Migrations do motor (PR05 a PR11) aplicadas na ordem.
3. `PayloadResolver` real registrado. Sem ele o ciclo do dispatcher responde `payload_resolver_not_configured` e não reserva nada.
4. Organização do piloto, 1 SDR e 1 closer definidos e ativos em `organization_members`.
5. Opt-in e janela de WhatsApp conforme a seção 2 do plano. Evolution só para continuidade autorizada.
6. Cron `dispatch-send-outbox` conforme a seção 10.4 do plano, somente depois de tudo acima.

## 4. Ordem de ativação (referência, ação separada e aprovada)

Sempre os mecanismos de segurança antes dos de efeito, e sempre por organização:

1. `conversation_ownership_v1`
2. `send_gateway_shadow`, comparar os logs `send_gateway_shadow`, só então `send_gateway_enforced`
3. `number_health_v1`
4. `send_outbox_enqueue`
5. `dispatcher_v1`
6. Cockpit e prioridade: `call_cockpit_v1`, `call_cockpit_outcomes`, `call_priority_v2`
7. Distribuição: `lead_assignment_shadow` (o enforced só depois de comparar os logs)

Exemplo de corte por organização, sem tocar em `enabled`:

```sql
UPDATE app_flags
SET allow_org_ids = array_append(allow_org_ids, '<ORG_ID>'::uuid)
WHERE key = 'conversation_ownership_v1'
  AND NOT ('<ORG_ID>'::uuid = ANY (allow_org_ids));
```

Restrição ao SDR e ao closer do piloto (opcional, nas flags com usuário):

```sql
UPDATE app_flags
SET allow_user_ids = ARRAY['<SDR_ID>'::uuid, '<CLOSER_ID>'::uuid]
WHERE key IN ('call_cockpit_v1', 'call_cockpit_outcomes', 'call_priority_v2');
```

## 5. Pausa

Objetivo: parar de enviar e de enfileirar, mantendo todos os controles de segurança ligados.

Execute na ordem. Cada passo é independente e imediato (o dispatcher reavalia a flag a cada item da rodada).

1. `dispatcher_v1`: nenhuma entrada nova é reservada ou enviada.
2. `send_outbox_enqueue`: nada novo entra na outbox.
3. `lead_assignment_enforced`, depois `lead_assignment_shadow`.
4. `call_priority_v2`: o cockpit volta a `pickNextLead` e `suggestApproach` v0.
5. `call_cockpit_outcomes`, depois `call_cockpit_v1`: o cockpit volta à tela anterior.

Pausa da organização do piloto (mantém as demais como estão):

```sql
UPDATE app_flags
SET allow_org_ids = array_remove(allow_org_ids, '<ORG_ID>'::uuid)
WHERE key IN (
  'dispatcher_v1', 'send_outbox_enqueue', 'lead_assignment_enforced',
  'lead_assignment_shadow', 'call_priority_v2', 'call_cockpit_outcomes', 'call_cockpit_v1'
);
```

Pausa total (todas as organizações), limpando listas e o valor global:

```sql
UPDATE app_flags
SET enabled = false, allow_org_ids = '{}', allow_user_ids = '{}'
WHERE key IN (
  'dispatcher_v1', 'send_outbox_enqueue', 'lead_assignment_enforced',
  'lead_assignment_shadow', 'call_priority_v2', 'call_cockpit_outcomes', 'call_cockpit_v1'
);
```

### O que NÃO desligar na pausa

Não desligue `send_gateway_enforced`, `send_gateway_shadow`, `conversation_ownership_v1` nem `number_health_v1`. Com o dispatcher e a outbox pausados nada sai; desligar estas flags só serviria para reabrir um caminho sem gateway, dono ou saúde de número, o que é bypass. Se uma delas precisar mudar, trate como mudança planejada com a outbox esvaziada e o dispatcher desligado, aprovada à parte.

Se a leitura da flag do gateway falhar, o modo vale `enforced` (fail-closed). Isso é intencional.

## 6. Rollback

Rollback aqui significa voltar ao comportamento anterior ao piloto, sem restaurar nenhum envio fora do gateway.

1. Execute a pausa da seção 5.
2. Confirme o cockpit na tela anterior e a ausência de movimento na outbox (seção 7).
3. Entradas `uncertain` e `sending` com lease vencido NÃO são reenviadas. Seguem para a reconciliação (callback com o id do provedor ou ação manual). Reabrir o dispatcher não as reenvia às cegas.
4. Entradas `pending` que não devem mais sair: decisão manual e aprovada. Este PR não adiciona ação de cancelamento.
5. Migration é forward-only. As colunas `allow_org_ids` e `allow_user_ids` ficam (vazias não alteram nada). Não faça DROP.
6. Não desagende nem edite workflows n8n por conta própria; é ação separada e aprovada. Nenhum workflow foi alterado por este PR.

Proibido no rollback: redistribuir envio para outro número, canal ou provedor; criar, trocar ou rotacionar números; reativar a fila antiga como substituto; apagar supressão, hold ou opt-out.

## 7. Verificação

Painel somente leitura (gestor): `/settings/motor-contato`. Mostra, para a sua organização, estado efetivo das flags, modo do gateway, contagens de `decision_events` (7 dias), outbox por status e saúde dos números. Valores que não puderam ser lidos aparecem como indisponíveis, nunca como zero. As comparações do gateway em shadow ficam apenas nos logs estruturados `send_gateway_shadow` (sem contagem no banco).

Depois de uma pausa, confirme:

1. Flags de efeito da lista da seção 5 aparecem como "Desligada" para a organização.
2. `send_outbox` sem avanço: `pending`, `reserved` e `sending` não crescem; `sent` não aumenta.
3. Cockpit na tela anterior e sem cartão de prioridade v2.
4. Flags de segurança continuam ligadas.

Consultas de apoio (somente leitura):

```sql
SELECT key, enabled, cardinality(allow_org_ids) AS orgs, cardinality(allow_user_ids) AS users
FROM app_flags
WHERE key IN (
  'call_cockpit_v1', 'call_cockpit_outcomes', 'conversation_ownership_v1',
  'send_gateway_shadow', 'send_gateway_enforced', 'send_outbox_enqueue',
  'dispatcher_v1', 'lead_assignment_shadow', 'lead_assignment_enforced',
  'number_health_v1', 'call_priority_v2'
)
ORDER BY key;

SELECT status, count(*) FROM send_outbox WHERE org_id = '<ORG_ID>' GROUP BY status ORDER BY status;
```

## 8. Critérios de parada imediata do piloto

Pause (seção 5) e investigue se qualquer um ocorrer:

- Número em `paused` ou `review` por restrição, denúncia confiável ou queda de sessão.
- Qualquer entrada `uncertain` inesperada ou crescimento de `failed`.
- Pedido de parar (`hold total`) seguido de qualquer envio ao mesmo contato.
- Divergência persistente entre o gateway em shadow e a decisão atual, sem explicação.

## 9. Captura de consentimento de WhatsApp (`consent_capture_v1`)

Grava `opt_in` e `opt_out` append-only em `contact_consent_evidence`. Nasce desligada: sem a linha da flag, ou com ela desligada para a organização, nada é lido nem gravado. A flag não tem migration; crie a linha desligada e depois ligue por organização:

```sql
INSERT INTO app_flags (key, enabled, note)
VALUES ('consent_capture_v1', false, 'Captura de consentimento de WhatsApp (formulário, inbound, Ana V4)')
ON CONFLICT (key) DO NOTHING;

UPDATE app_flags
SET allow_org_ids = array_append(allow_org_ids, '<ORG_ID>'::uuid)
WHERE key = 'consent_capture_v1'
  AND NOT ('<ORG_ID>'::uuid = ANY (allow_org_ids));
```

Pausa: `array_remove(allow_org_ids, '<ORG_ID>'::uuid)` (ou `enabled = false` e listas vazias para todas). Pausar a captura NÃO apaga evidência já gravada, e o `opt_out` gravado continua valendo no gateway. Esta flag pode ser pausada sem risco de bypass: ela só adiciona evidência, nunca envia.

Origens gravadas (`source`):

| Fluxo | kind | source | Referência (`evidence.ref`) |
|-------|------|--------|-----------------------------|
| Formulário/LP via `POST /api/v1/leads` ou `/api/webhooks/inbound-leads` com `consent_whatsapp=true` | `opt_in` | `lead_form` | `lead:<lead_id>` |
| Mensagem inbound (Meta oficial e Evolution), lead escreveu primeiro | `opt_in` | `inbound_message` | `inbound:<identidade>` |
| Mensagem inbound pedindo para parar | `opt_out` | `inbound_stop_request` | id da mensagem |
| Botão "Aceitou WhatsApp" no cockpit, após ligação atendida | `opt_in` | `call_verbal_consent` | `call:<call_id>` |
| `POST /api/v1/edge/consent` (Ana V4) | `opt_in` ou `opt_out` | `ana_v4_opt_in`, `ana_v4_opt_out` | `x-idempotency-key` ou (tipo, lead, telefone) |

Contrato para as LPs: o payload precisa enviar `consent_whatsapp: true` (ou a string `"true"`) quando o visitante marcar o aceite de contato por WhatsApp. Sem o campo, ou com qualquer outro valor, nada é gravado. Nenhuma LP envia isso hoje; a tabela `landing_leads` (LP do próprio produto) não tem `org_id` nem `lead_id` e não entra neste fluxo.

Rota da Ana V4, mesma API key das rotas `/bdr`:

```
POST /api/v1/edge/consent
Authorization: Bearer <API_KEY>
x-idempotency-key: <chave opcional>
{ "lead_id": "<uuid>", "telefone": "5516999867577", "tipo": "opt_in" | "opt_out", "fluxo": "<nome opcional>" }
```

Respostas: `201` gravou; `200` com `data.status` em `disabled`, `duplicate`, `skipped_opted_out`, `already_opted_out`; `404` lead fora da organização; `422` payload inválido.

Regras: `opt_out` vence. Um `opt_in` automático (formulário, inbound, Ana) não é gravado sobre um `opt_out` vigente, e o gateway lê sempre o último evento da identidade. Reverter um `opt_out` é decisão manual e auditada, não deste fluxo. As origens acima não estão em `CONTACT_REQUEST_SOURCES` do gateway: liberam o primeiro contato oficial (com template), não a continuidade via Evolution.

### Aceite verbal na ligação (botão "Aceitou WhatsApp")

No cockpit, o painel de resultado da ligação (`CallOutcomePanel`, dentro do `NextCallCard`) mostra o botão "Aceitou WhatsApp" somente com `consent_capture_v1` ligada para a organização e depois que a ligação foi atendida (`answered_at` presente ou duração medida). O botão fica disponível por 30 minutos após o atendimento. Ao clicar, a server action grava `opt_in` com source `call_verbal_consent`:

- `evidence.ref = call:<call_id>` (idempotente por ligação), mais `call_id` e `registered_by` (usuário); `created_by` recebe o usuário que registrou.
- Identidade no formato `55...`, a partir do número que atendeu (`calls.destination`), com o telefone cadastrado do lead como alternativa.
- Só para ligações e leads da organização do usuário. SDR e closer só nas próprias ligações ou de leads da própria carteira; gestor em toda a organização. A leitura usa o cliente do usuário (RLS).
- `opt_out` vigente vence: o aceite verbal não é gravado e o usuário recebe a mensagem de que o contato pediu para não receber.

**Regra de conteúdo:** o primeiro template enviado após esse opt-in deve referenciar a conversa, por exemplo "conforme falamos na ligação". Um template genérico não corresponde ao que foi combinado por telefone e não deve ser o primeiro contato após um aceite verbal. O gateway não impõe isso hoje; é regra de quem escolhe o template. `call_verbal_consent` não está em `CONTACT_REQUEST_SOURCES`, então não libera a continuidade via Evolution.

Carga única dos leads atuais: `docs/runbooks/consent-backfill.sql` (sources `backfill_form` e `backfill_inbound`). Rode a contagem do topo, valide com o jurídico e só então os INSERT.
