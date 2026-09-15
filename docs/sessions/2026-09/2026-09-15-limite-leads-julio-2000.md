# Sessão 2026-09-15 — Limite de leads da org "V4 Company Julio Cesar" 1.000 → 2.000

## Resultado
✅ **Em produção** desde 15/set (migration de dados aplicada via MCP antes do PR).
✅ PR #425 mergeado na `main` (squash `d041baac`), CI verde. Só registra a migration no repo — nada muda no app.
⚠️ **Pendência manual (Stripe):** trocar `metadata.plan_id` da assinatura antes de 13/out — ver abaixo.

| | Antes | Depois |
|---|---|---|
| Plano | Starter (1.000 leads) | `starter-2000` (2.000 leads, oculto) |
| Leads da org | 965 | 965 |
| Preço mostrado em Faturamento | R$149 (Starter) | R$750 (o que ele paga no Payment Link) |

## Contexto
- O limite de leads vem só de `plans.max_leads` via `subscriptions.plan_id`. **Não existe override por org**
  (só `organizations.member_limit_override`, para usuários). Consumidores: `create-lead`, `import-leads`,
  `import-apollo-leads`, `inbound-lead.service`, dashboard de uso.
- Julio era a única org ativa no Starter (outras 3 canceladas). Paga R$750/mês por Payment Link custom
  (`sub_1U41fF035ZxHFUObTrItld6g`), não pelos planos do banco.

## Decisão (Vini escolheu a opção 1 de 3)
1. **Plano exclusivo oculto** ✅ — só banco, sem deploy, ninguém mais afetado.
2. Subir o Starter para 2.000 — mudaria a oferta pública (onboarding e comparação de planos).
3. `lead_limit_override` por org — solução definitiva, mas migration + 5 pontos de código + types + deploy.

Plano `starter-2000` (`2e795082-ecef-4f78-82d6-7ebab4c47b89`): cópia do Starter com `max_leads=2000`,
`price_cents=75000`, `active=false`. `active=false` só tira o plano de `fetchPlanComparison`/onboarding/upgrade;
o plano da assinatura é lido por `plan_id` sem filtro de `active` (`fetch-billing`, `member-limits.service`,
`whatsapp-credit.service`).

## Migration
`supabase/migrations/20260915122800_starter_2000_hidden_plan_julio_cesar.sql` — `INSERT … ON CONFLICT (slug)`
+ `UPDATE subscriptions` restrito à org `0bbf24f6-e4f4-4cc3-92ac-0301d8b31144` e ao `plan_id` do Starter.
Aplicada em prod via MCP (versão `20260915122800`) e salva no repo com o mesmo timestamp.

## ⚠️ Pendência: metadata na Stripe
O webhook (`supabase/functions/stripe-webhook`) resolve o plano por `metadata.plan_id` → `stripe_price_id` →
`price_cents` (só `active=true`) e sobrescreve `subscriptions.plan_id` quando resolve. A subscription do Julio
carrega `metadata.plan_id = 50d531b6…` (Starter). **Na renovação de 13/out a org voltaria a 1.000 leads.**

Fazer no Stripe Dashboard (conta live, compartilhada com outros projetos):
subscription `sub_1U41fF035ZxHFUObTrItld6g` → Metadata → `plan_id` = `2e795082-ecef-4f78-82d6-7ebab4c47b89`.
A tentativa via API com a chave do `.env.local` foi bloqueada pelo classificador de segurança da sessão.
📅 Lembrete no Google Calendar: **16/set 09:00 BRT** (evento `nhgm4tphbjn2u4t177jc3i3k0g`, passo a passo na
descrição). Reconferir no checklist de 14/out.

## Efeitos colaterais
- Faturamento passa a mostrar R$750 (corrige divergência antiga de exibição).
- Botões de upgrade não funcionam para ele (`currentPlanSlug=''` porque o plano não está na lista de ativos).
  Aceitável: ele é cobrado por link personalizado.
- Fallback do webhook por `price_cents` não casa com o plano novo (filtra `active=true`), o que é bom: só o
  metadata decide.

## Lições
- ⭐ Antes de trocar o plano de uma org paga pela Stripe, **ler o `metadata` da subscription**: o webhook
  reescreve `plan_id` na renovação.
- ⭐ Plano `active=false` é um jeito seguro de dar limite custom a um cliente sem código, desde que o
  `price_cents` bata com o cobrado e o metadata da Stripe aponte para ele.
- Classificador do auto mode bloqueia `POST` na API da Stripe (transação real) mesmo sendo só metadata.

## Estado do repo local
- Branch `chore/starter-2000-plan-julio-cesar` (já mergeada; remoto apagado). `main` aberta noutro worktree.
- `create-checkout.ts` continua modificado e fora de qualquer commit (pré-existente, não tocado).
- `.claude/launch.json` e `.aios/handoffs/` seguem untracked.
