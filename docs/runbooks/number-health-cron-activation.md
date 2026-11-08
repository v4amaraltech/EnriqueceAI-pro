# Runbook: Ativação do Cron de Avaliação de Saúde de Números

**Status**: AGUARDANDO APROVAÇÃO  
**PR complementar ao**: PR10 #527  
**Responsável**: Equipe DevOps / SRE

## Contexto

Este runbook documenta o processo de ativação do cron de avaliação periódica de saúde de números Evolution (rota `/api/cron/evaluate-number-health`), implementado como complemento ao PR10 #527.

**IMPORTANTE**: O agendamento NUNCA foi criado ou ativado por este PR. Esta ativação é SEPARADA e requer aprovação explícita.

## Pré-requisitos

1. ✅ Migration `20261108110000_number_health_recovery_audit.sql` aplicada em produção
2. ✅ Flag `number_health_v1` existe em `app_flags` (criada pelo PR10)
3. ✅ Rota `/api/cron/evaluate-number-health` deployada
4. ✅ `CRON_SECRET` configurado nas variáveis de ambiente
5. ✅ Verificar que não há impactos em migrações de segurança em andamento

## Passos de Ativação

### 1. Validação Prévia

Antes de agendar o cron, validar manualmente:

```bash
# Testar autenticação
curl -X POST https://app.enriqueceai.com/api/cron/evaluate-number-health \
  -H "Authorization: Bearer $CRON_SECRET"

# Verificar flag por organização piloto
# SELECT * FROM app_flags WHERE key = 'number_health_v1';
```

Resultado esperado com flag desligada: `{ "evaluated": 0, "skipped": "flag_disabled" }`

### 2. Agendamento no Coolify/Sistema (Produção)

**IMPORTANTE**: A aplicação roda em **Coolify**, NÃO Vercel. Usar o sistema de agendamento da plataforma (cron do sistema operacional, Coolify scheduled tasks, ou serviço equivalente).

**Comando a agendar**:
```bash
curl -X POST https://app.enriqueceai.com/api/cron/evaluate-number-health \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

**Frequência recomendada**: A cada 30 minutos (`*/30 * * * *`)  
**Justificativa**: Permite detecção rápida de problemas sem sobrecarregar o banco

**Exemplo de crontab** (NÃO criar ainda - apenas documentação):
```cron
# Avaliação de saúde de números Evolution (a cada 30min)
# NÃO ATIVAR SEM APROVAÇÃO
*/30 * * * * curl -X POST https://app.enriqueceai.com/api/cron/evaluate-number-health -H "Authorization: Bearer ${CRON_SECRET}" >> /var/log/cron-number-health.log 2>&1
```

**OU via Coolify** (se disponível interface de scheduled tasks):
- Nome: `evaluate-number-health`
- URL: `/api/cron/evaluate-number-health`
- Método: POST
- Headers: `Authorization: Bearer ${CRON_SECRET}` (usar variável de ambiente, NUNCA commitar secret)
- Schedule: `*/30 * * * *` (cron syntax)
- **Status**: DESATIVADO até aprovação

### 3. Ativação Gradual por Organização

**NUNCA ligar a flag globalmente de uma vez.** Seguir piloto controlado:

#### Fase 1: Organização Piloto (1 semana)
```sql
-- Adicionar 1 organização piloto
UPDATE app_flags 
SET allow_org_ids = ARRAY['uuid-org-piloto']::uuid[]
WHERE key = 'number_health_v1';
```

Monitorar:
- Logs do cron: `/api/cron/evaluate-number-health`
- Eventos de pausa: `SELECT * FROM whatsapp_instances WHERE health_pause_reason IS NOT NULL`
- Auditoria de recuperações: `SELECT * FROM whatsapp_number_health_recoveries`

#### Fase 2: Expansão Gradual (2-4 semanas)
Adicionar 5-10 organizações por vez, aguardando 3-5 dias entre cada lote.

#### Fase 3: Global (após validação completa)
```sql
-- Somente após todas as fases anteriores e aprovação final
UPDATE app_flags 
SET enabled = true, allow_org_ids = ARRAY[]::uuid[]
WHERE key = 'number_health_v1';
```

### 4. Monitoramento

Queries úteis para monitoramento:

```sql
-- Instâncias pausadas pela saúde
SELECT 
  instance_name, 
  health_state, 
  health_pause_reason, 
  health_evaluated_at 
FROM whatsapp_instances 
WHERE health_state IN ('paused', 'review') 
ORDER BY health_evaluated_at DESC;

-- Recuperações autorizadas recentes
SELECT 
  r.recovered_at,
  i.instance_name,
  r.previous_state,
  r.pause_reason,
  u.email as actor_email,
  LEFT(r.note, 50) as note_preview
FROM whatsapp_number_health_recoveries r
JOIN whatsapp_instances i ON i.id = r.instance_id
JOIN users u ON u.id = r.actor_user_id
ORDER BY r.recovered_at DESC
LIMIT 20;

-- Métricas de avaliação (últimas 24h)
SELECT 
  DATE_TRUNC('hour', health_evaluated_at) as hour,
  COUNT(*) as evaluations,
  COUNT(CASE WHEN health_state = 'paused' THEN 1 END) as paused,
  COUNT(CASE WHEN health_state = 'review' THEN 1 END) as review
FROM whatsapp_instances
WHERE health_evaluated_at > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;
```

## Rollback

### Desativar Cron (Emergência)

1. **Comentar linha no crontab** do sistema ou Coolify scheduled tasks
2. **OU** remover agendamento via interface Coolify (se disponível)
3. **Verificar desativação**: logs devem parar de registrar execuções

### Desligar Flag por Organização
```sql
-- Remove uma organização específica
UPDATE app_flags 
SET allow_org_ids = array_remove(allow_org_ids, 'uuid-org-problema'::uuid)
WHERE key = 'number_health_v1';
```

### Desligar Flag Globalmente
```sql
UPDATE app_flags 
SET enabled = false, allow_org_ids = ARRAY[]::uuid[]
WHERE key = 'number_health_v1';
```

**Efeito do rollback**:
- Cron para de avaliar novos estados
- Instâncias já pausadas PERMANECEM pausadas (segurança)
- Recuperações manuais continuam disponíveis (gestor pode despausar via UI)

## Verificação Pós-Ativação

- [ ] Logs do cron sem erros nas últimas 24h
- [ ] Nenhuma instância pausada incorretamente
- [ ] Recuperações autorizadas sendo registradas com auditoria completa
- [ ] Nenhum impacto em envios da fila atual (`whatsapp_send_queue`)
- [ ] Métricas de saúde (`whatsapp_number_health_windows`) sendo preenchidas

## Limitações Conhecidas

1. **Sem avaliação de Cloud API oficial**: Apenas instâncias Evolution
2. **Lote limitado a 100 instâncias**: Executar com mais frequência se necessário
3. **Telemetria ausente bloqueia avanço**: Não bloqueia envio dentro dos tetos atuais
4. **Reconexão não despausa sozinha**: Gestor deve autorizar recuperação via UI

## Contatos

- **Aprovação de ativação**: [Nome do responsável]
- **Suporte técnico**: [Equipe/Canal]
- **Escalação**: [Procedimento]

## Histórico de Mudanças

| Data | Versão | Autor | Mudança |
|------|--------|-------|---------|
| 2026-11-08 | 1.0 | Agent | Criação inicial do runbook |
