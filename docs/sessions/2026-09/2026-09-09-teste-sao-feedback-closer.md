# Roteiro de teste — Oportunidade Qualificada (SAO) no feedback do closer

**Data:** 09/09/2026
**PR:** #369 (squash `00021efb`) — no ar em produção (`/api/version` = `00021ef`)
**Migration:** `20260909120000_closer_feedback_oportunidade_qualificada.sql` — aplicada em prod antes do deploy

## Por que dá para testar em produção com segurança

Levantamento feito no banco em 09/set:

| Papel | Quem |
|---|---|
| Closers cadastrados | Jhonata Banqueri, Pedro Neves, **Vinicius Mercante** |
| Managers ativos na org | **apenas Vinicius Mercante** |

Escolhendo **Vinicius Mercante como closer** do lead de teste, o link de feedback (e-mail + WhatsApp) e o e-mail de alerta ao gestor caem **os dois em você**. Nenhum closer real recebe nada.

> ⚠️ Se escolher Jhonata ou Pedro como closer, eles recebem e-mail **e WhatsApp** de verdade. Não faça isso no teste.

---

## Passo a passo

### 1. Criar o lead de teste

Pela interface, em Leads → Novo lead:

- **Nome fantasia:** `TESTE SAO 09-09` (prefixo claro para achar e apagar depois)
- **CNPJ:** qualquer um válido que não exista na base
- **Responsável:** você mesmo

### 2. Levar o lead até "Ganho"

1. Qualifique o lead (status `qualified`)
2. Agende a reunião (qualquer data)
3. Clique em **Ganho** e selecione o closer **Vinicius Mercante**

Isso dispara `markLeadAsWon` → cria o `closer_feedback_request` e envia o link por e-mail e WhatsApp para você.

### 3. Responder o formulário — passe 1: caminho de alerta

Abra o link recebido e preencha:

| Campo | Valor |
|---|---|
| Resultado da reunião | **Realizada** |
| A qualificação bateu? | Bateu |
| O decisor estava na call? | Sim |
| **Oportunidade Qualificada (SAO)** | **Não qualificada** |
| Observações | `teste SAO — ignorar` |

**O que verificar na tela:**

- [ ] A pergunta "Oportunidade Qualificada (SAO)" aparece entre "O decisor estava na call?" e "Observações"
- [ ] O botão "Enviar feedback" fica **desabilitado** enquanto ela não for respondida
- [ ] A opção escolhida fica destacada em vermelho, igual às outras perguntas

### 4. Conferir os efeitos

**E-mail do SDR** (para você):
- [ ] Linha "Oportunidade Qualificada (SAO): **Não qualificada**" em vermelho

**E-mail do gestor** (para você, assunto começa com `[Gestor] ⚠️`):
- [ ] Assunto tem o ⚠️
- [ ] Caixa amarela "Motivo do alerta" cita *"o closer não aceitou a oportunidade (SAO: não qualificada)"*
- [ ] Mesma linha de SAO na tabela de detalhes

**Card do lead** (`/leads/<id>`, seção "Feedback do Closer"):
- [ ] Bloco "Oportunidade Qualificada (SAO): Não qualificada" em vermelho

**Tela Feedbacks dos Closers** (`/settings/prospecting/closer-feedbacks`):
- [ ] Coluna "SAO" com o selo vermelho "Não qualificada"
- [ ] Card "Oportunidades qualificadas (SAO)" mostrando a porcentagem e "X de Y avaliadas"

**Estatísticas** (`/statistics/feedback`):
- [ ] KPI "Oportunidades qualificadas (SAO)"
- [ ] Coluna SAO na tabela e "% SAO" no ranking de closers

### 5. Passe 2 (opcional) — caminho saudável

Repita com um segundo lead de teste, respondendo **Qualificada**. Esperado:

- [ ] E-mail do gestor **sem** ⚠️, moldura informativa ("Feedback do closer")
- [ ] Selo verde "Qualificada" na tabela e no card do lead

### 6. Verificação no banco

```sql
-- Feedbacks de teste com o campo novo
SELECT l.nome_fantasia,
       f.result,
       f.qualificacao_aderente,
       f.decisor_presente,
       f.oportunidade_qualificada,   -- <<< o campo novo
       f.comment,
       f.responded_at
FROM closer_feedback_requests f
JOIN leads l ON l.id = f.lead_id
WHERE l.org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
  AND l.nome_fantasia ILIKE 'TESTE SAO%'
ORDER BY f.created_at DESC;
```

Esperado: `oportunidade_qualificada = false` no passe 1, `true` no passe 2.

**Teste do constraint** (deve FALHAR, e é isso que queremos):

```sql
-- Tentar gravar SAO em um feedback que não é de reunião realizada
UPDATE closer_feedback_requests
SET result = 'no_show', oportunidade_qualificada = true
WHERE id = '<id do feedback de teste>';
-- esperado: ERROR ... violates check constraint "closer_feedback_sao_somente_se_realizada"
```

### 7. Limpeza

Soft delete dos leads de teste (mesmo padrão usado no teste dos guard-rails do Pular):

```sql
UPDATE leads
SET deleted_at = now()
WHERE org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
  AND nome_fantasia ILIKE 'TESTE SAO%'
  AND deleted_at IS NULL
RETURNING id, nome_fantasia;
```

Anote os IDs devolvidos no fim deste arquivo, para rastreabilidade.

---

## Resultado

| Passe | Data | Resultado |
|---|---|---|
| 1 — Não qualificada | | |
| 2 — Qualificada | | |
| Constraint | | |
| Limpeza (IDs) | | |
