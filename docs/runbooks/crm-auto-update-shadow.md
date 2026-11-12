# Atualização automática do CRM pela IA (modo shadow)

Código: `src/features/calls/services/crm-auto-update/`. Migrations: `supabase/migrations/20261111200000_crm_auto_update_shadow.sql`
(v1) e `supabase/migrations/20261112120000_crm_auto_update_shadow_opt_out.sql` (v1.1, só depois do PR aprovado).

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

Não use `enabled = true` (ligaria todas as orgs). Não mexa em `crm_auto_update_v1_live`.

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
