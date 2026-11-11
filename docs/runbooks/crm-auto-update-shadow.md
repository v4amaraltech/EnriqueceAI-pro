# Atualização automática do CRM pela IA (modo shadow)

Código: `src/features/calls/services/crm-auto-update/`. Migration: `supabase/migrations/20261111200000_crm_auto_update_shadow.sql`.

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
