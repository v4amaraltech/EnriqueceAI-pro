-- Aplicada em prod via MCP em 15/set/2026 (versão 20260915122800).
-- Plano exclusivo e oculto para a org "V4 Company Julio Cesar": cópia do Starter
-- com max_leads 2000 e preço igual ao cobrado no Payment Link (R$750/mês).
-- active=false: não aparece em onboarding, comparação de planos nem upgrade.
-- O metadata.plan_id da assinatura na Stripe (sub_1U41fF035ZxHFUObTrItld6g) foi
-- apontado para este plano, senão a renovação devolveria a org ao Starter.
BEGIN;

INSERT INTO plans (name, slug, price_cents, max_leads, max_ai_per_day, max_whatsapp_per_month,
                   included_users, additional_user_price_cents, features, active)
SELECT 'Starter 2000', 'starter-2000', 75000, 2000, s.max_ai_per_day, s.max_whatsapp_per_month,
       s.included_users, s.additional_user_price_cents, s.features, false
FROM plans s
WHERE s.slug = 'starter'
ON CONFLICT (slug) DO UPDATE SET max_leads = EXCLUDED.max_leads, active = false;

-- Move somente a assinatura da org "V4 Company Julio Cesar".
UPDATE subscriptions
SET plan_id = (SELECT id FROM plans WHERE slug = 'starter-2000')
WHERE org_id = '0bbf24f6-e4f4-4cc3-92ac-0301d8b31144'
  AND plan_id = (SELECT id FROM plans WHERE slug = 'starter');

COMMIT;
