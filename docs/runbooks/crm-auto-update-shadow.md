# Atualização automática do CRM pela IA (modo shadow)

Código: `src/features/calls/services/crm-auto-update/`. Migrations: `supabase/migrations/20261111200000_crm_auto_update_shadow.sql`
(v1), `supabase/migrations/20261112120000_crm_auto_update_shadow_opt_out.sql` (v1.1) e
`supabase/migrations/20261112200000_crm_auto_update_live_voicemail.sql` (escrita live, só depois do PR aprovado).

## O que acontece

Quando o motor de transcrição (`call_transcription_engine_v1`) conclui a qualificação JEV de uma ligação,
o worker chama `runCrmAutoUpdate`. Com a org em shadow, ele calcula o que o CRM mudaria e grava UMA linha
em `crm_auto_update_shadow_log` (uma por ligação). Nada é escrito em `calls`, `scheduled_activities`,
`leads` nem `interactions`.

Pré-requisito: a org também precisa estar com `call_transcription_engine_v1` ligada, senão não há qualificação.

## Ligar o shadow para a V4 Amaral

```sql
UPDATE public.app_flags
SET allow_org_ids = array_append(allow_org_ids, 'c2727473-1df8-4faa-9264-a9fc1759fe3b'::uuid)
WHERE key = 'crm_auto_update_v1'
  AND NOT ('c2727473-1df8-4faa-9264-a9fc1759fe3b'::uuid = ANY (allow_org_ids));
```

Não use `enabled = true` (ligaria todas as orgs). Não mexa em `crm_auto_update_v1_live` (ver "Escrita live" abaixo).

## Desligar

```sql
UPDATE public.app_flags
SET allow_org_ids = array_remove(allow_org_ids, 'c2727473-1df8-4faa-9264-a9fc1759fe3b'::uuid)
WHERE key = 'crm_auto_update_v1';
```

## Medir

```sql
-- Concordância diária
SELECT * FROM public.crm_auto_update_shadow_agreement_daily
WHERE org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b' ORDER BY day DESC;

-- Divergências
SELECT call_id, ai_outcome, ai_confidence, proposed_disposition, sdr_disposition, verdict, skip_reason
FROM public.crm_auto_update_shadow_comparison
WHERE org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b' AND disposition_comparison = 'disagree'
ORDER BY decided_at DESC;
```

As views leem `calls.sdr_disposition` ao vivo, então a comparação melhora à medida que os SDRs registram.
`legacy_ai` (desfecho gravado pelo fluxo antigo do Power Dialer) fica fora da conta.

## Regra v1.1 (medição de 11/11)

`rules_version = 'v1.1'` separa os logs novos dos antigos (`'v1'`). Compare sempre filtrando por versão.

### not_connected e voicemail nunca viram "atendeu sem avanço"

Desfecho JEV `not_connected` (ou `voicemail`) sempre propõe `disposition = voicemail` e nova tentativa por
telefone, com ou sem prompt de caixa postal reconhecido no texto. Caso real: `3e597c42` (URA "se você disser
seu nome e o motivo da ligação... essa pessoa não está disponível") caía em `answered_no_progress`.

### Opt-out: só propomos, nunca aplicamos

Quando a transcrição (ou o resumo da qualificação) traz pedido CLARO de sair da lista ou de apagar, tirar ou
remover telefone, e-mail, WhatsApp ou contato, a decisão vira `skip` com `skip_reason = 'opt_out_requested'`,
antes de needs_review e de confiança, para todo pedido ser contado. "Não tenho interesse" e "agora não" não
contam. Detector: `opt-out.ts` (`detectOptOutRequest`).

O log guarda só o sinal e uma proposta documental, sem copiar o texto da ligação:

- `proposed_changes.opt_out = {requested, channels, patterns, suggested_actions, applied: false}`;
- `input_snapshot.opt_out_requested` e `input_snapshot.opt_out_channels`.

`suggested_actions` aponta os fluxos que já existem e que um humano usaria. NADA disso é executado pelo shadow,
pelo worker ou pelo futuro live sem PR próprio:

| Canal | Fluxo existente |
|-------|-----------------|
| e-mail | `email_suppressions` (reason `unsubscribe`), o mesmo do `/unsubscribe/[token]` |
| WhatsApp / telefone | `contact_consent_evidence` com `kind = 'opt_out'` (append-only, flag `consent_capture_v1`) |
| todos | parar `cadence_enrollments` ativas do lead (status `unsubscribed`) |

`email_blacklist` NÃO serve: é por domínio e bloquearia a empresa inteira (ou gmail.com inteiro).
Nunca apagar nem reescrever lead, contato, e-mail ou telefone por causa deste sinal.

```sql
-- Pedidos de opt-out detectados
SELECT call_id, decided_at, ai_outcome, ai_confidence, sdr_disposition
FROM public.crm_auto_update_shadow_comparison
WHERE org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b' AND skip_reason = 'opt_out_requested'
ORDER BY decided_at DESC;
```

A view diária ganha `skipped_opt_out_requested` (última coluna) com a migration v1.1.

### Ordem de aplicação

O CHECK de `skip_reason` só aceita `opt_out_requested` depois da migration `20261112120000`. Se o código v1.1
subir antes dela, a ligação com opt-out falha no INSERT e o worker registra `log_failed` (nada é escrito no CRM,
as demais ligações seguem normais). Aplique a migration junto com o deploy, depois do PR aprovado.

### Caso documentado, sem regra: "não, obrigado" + "daqui uns dias"

`a52ce579` (422s, conf 0,83): recusa clara e, no fim, um "daqui uns dias" de cortesia. A regra segue
propondo `not_interested → answered_no_progress`, próxima atividade `none`. Não mudamos porque a
transcrição não diz QUEM falou cada frase: "daqui uns dias eu te ligo" do SDR viraria retorno para quem
recusou. Revisar quando houver atribuição de speaker.

## Escrita live: só caixa postal

Desde a migration `20261112200000`, o modo live escreve no CRM, com escopo estreito. Todo o resto segue
só no log, igual ao shadow.

### Escopo

Escreve se, e somente se (`shouldApplyLiveVoicemail` em `decision.ts`):

- a org está em `allow_org_ids` de `crm_auto_update_v1` E de `crm_auto_update_v1_live` (modo `live`);
- a decisão é `would_apply` (já passou por opt-out, needs_review, confiança 0,75, SDR já registrado, sem lead);
- o desfecho JEV é exatamente `voicemail`. `not_connected` também propõe `voicemail`, mas NÃO escreve;
- confiança >= 0,85 (`CRM_AUTO_UPDATE_LIVE_VOICEMAIL_MIN_CONFIDENCE`). 0,84 fica só no log como `would_apply`.

O corte 0,75 do `would_apply` no log não mudou. `enabled = true` global na flag live continua ignorado:
live só para org listada explicitamente. Nunca ligue a flag live com `enabled = true`.

### O que é escrito

Uma única escrita fora do log, condicional:

```sql
UPDATE calls
SET sdr_disposition = 'voicemail',
    metadata = <metadata atual> || {"crm_auto_update": {...}},
    updated_at = now()
WHERE id = :call_id AND org_id = :org_id AND sdr_disposition IS NULL;
```

Não cria `scheduled_activities` (a cadência segue sozinha), não muda `leads.status`, não escreve em
`interactions`, não toca `call_transcripts_v2` nem `call_qualifications`. Se o UPDATE pega 0 linhas (o SDR
chegou na frente), nada é forçado: o log vira `skip` com `already_dispositioned` e `input_snapshot.live_write_conflict = true`.

O log nasce com `applied = true` e `applied_at` (mesmo valor do marcador). `applied` só pode ser true com
`mode = 'live'` e `verdict = 'would_apply'` (CHECK). Linhas antigas ficam `applied = false`.

### Idempotência e recuperação

O marcador `calls.metadata.crm_auto_update = {applied, disposition, applied_at, qualification_id, rules_version, source}`
vai no MESMO UPDATE. Ele é diferente de `metadata.ai_outcome` (fluxo antigo do Power Dialer).

- Log já existe: `already_logged`, nada é escrito (o log é append-only).
- UPDATE falhou com erro de banco: nada é gravado, nem o log (`crm_write_failed`), para o retry decidir de novo.
- UPDATE passou e o INSERT do log falhou: na próxima execução, sem log e com `sdr_disposition = 'voicemail'` +
  marcador, o worker NÃO escreve no CRM de novo e grava só o log com `applied = true`, `applied_at` do marcador
  e `input_snapshot.recovered_from_marker = true` (`applied_recovered`).
- `sdr_disposition` preenchido sem o nosso marcador: `skip already_dispositioned`, como antes.

### Medição

A view de comparação lê `calls.sdr_disposition` ao vivo. Depois da nossa escrita, esse valor é o nosso, não o
do SDR. Por isso `auto_applied` vem antes de `agree`/`disagree` nas três comparações e essas linhas ficam
fora de `compared`, `agreed`, `diverged` e das taxas. A view diária conta essas linhas em `applied_live`
(última coluna).

```sql
-- Escritas live
SELECT call_id, decided_at, ai_outcome, ai_confidence, auto_applied_at, sdr_disposition
FROM public.crm_auto_update_shadow_comparison
WHERE auto_applied
ORDER BY decided_at DESC;
```

### Ordem de aplicação

Migration `20261112200000` PRIMEIRO, depois o deploy do código. Se o código subir antes, o INSERT com
`applied`/`applied_at` falha (`log_failed`); se isso acontecer depois de um UPDATE em calls, o marcador permite
gravar o log na próxima execução. Esta versão não liga nenhuma org: incluir uma org no live é decisão separada.

## Caminho hangup (sem JEV): só shadow

Código: `hangup-decision.ts` (classificação pura) e `hangup-shadow.service.ts` (`runHangupCrmShadow` e o
wrapper `triggerHangupCrmShadow`). Migration: `supabase/migrations/20261112220000_crm_auto_update_hangup_shadow.sql`.

O motor JEV só pega ligação atendida com 30 s ou mais. As demais com causa de hangup clara passam a ter
proposta no mesmo log, com `rules_version = 'hangup_v1'`, `qualification_id` nulo e
`input_snapshot.source = 'hangup_deterministic'`. Disparo: webhook API4COM (os dois ramos de hangup, depois
do UPDATE/INSERT) e reconcile (quando o hangup fica persistido). Portão de org: `crm_auto_update_v1` (shadow).
Idempotente pelo `UNIQUE (call_id)`: a segunda chamada vira `already_logged`.

### Mapeamento

| Causa | Condição | outcome (snapshot) | disposition | próxima atividade |
|-------|----------|--------------------|-------------|-------------------|
| `NUMBER_CHANGED` | sempre | voicemail | voicemail | retry phone |
| `NO_ANSWER`, `NO_USER_RESPONSE`, `ALLOTTED_TIMEOUT` | sem answered_at | no_answer | no_answer | retry phone |
| `USER_BUSY` | sem answered_at | busy | no_answer | retry phone |
| `CALL_REJECTED` | sem answered_at | rejected | no_answer | retry phone |
| `UNALLOCATED_NUMBER`, `INVALID_NUMBER_FORMAT` | mesmo com answered_at | invalid_number | technical_failure | none |
| `NORMAL_TEMPORARY_FAILURE`, `RECOVERY_ON_TIMER_EXPIRE` | sem answered_at | technical_failure | technical_failure | retry phone |

`NUMBER_CHANGED` é caixa postal (guia API4COM e PR598), mesmo que o SDR tenha marcado historicamente
"não atendeu". Confiança 1, `lead_status` sempre nulo. Veredito: `already_dispositioned` (SDR ou fluxo antigo
da IA), `no_lead`, ou `would_apply`, sempre com a proposta preenchida.

Medição desde o deploy do motor (11/11, 06:41, V4): 702 ligações com esses sinais, 478 com lead, 64 já com desfecho; 414 seriam
`would_apply` e 224 `no_lead`.

### O que NÃO classifica

- Atendida com 30 s ou mais (é do JEV).
- `NORMAL_CLEARING` atendida curta (390 no período): precisa de áudio.
- `ORIGINATOR_CANCEL` (344): o SDR desistiu e os desfechos registrados se dividem (sinal misto).
- Causa de "não atendeu" com answered_at preenchido (contraditório), causa nula ou desconhecida.

### Sem escrita no CRM

Sempre `mode = 'shadow'` e `applied = false`, mesmo com a org em live. Não escreve `calls.sdr_disposition`,
`calls.metadata`, `leads`, `scheduled_activities` nem `interactions`, e não passa por `shouldApplyLiveVoicemail`.
Sem backfill das ligações antigas.

```sql
SELECT input_snapshot->>'hangup_cause' AS causa, verdict, skip_reason, count(*)
FROM public.crm_auto_update_shadow_log
WHERE rules_version = 'hangup_v1'
GROUP BY 1, 2, 3 ORDER BY 4 DESC;
```

### Ordem de aplicação

Migration `20261112220000` PRIMEIRO, depois o código. Se o código subir antes, o INSERT com `qualification_id`
nulo falha (`log_failed` no console) e o log não entra; o webhook e o reconcile seguem normais (o wrapper
nunca lança).

### Plano do áudio (próximo PR)

`NORMAL_CLEARING` atendida curta fica para o piloto de escuta ao vivo que já está na main (flag
`webphone_live_amd`, `classifyLiveAmd`, resultado em `calls.metadata.live_amd`). Não há flag nova. A flag só
é ligada com autorização; depois disso, o PR seguinte despeja o resultado nesse mesmo log sombra.
