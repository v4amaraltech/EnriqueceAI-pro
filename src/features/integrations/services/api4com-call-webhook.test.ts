import { describe, expect, it } from 'vitest';

import { isValidCallWebhookUrl, planCallWebhookIntegration } from './api4com-call-webhook';

const N8N = 'https://webhook-n8n.v4companyamaral.com/webhook/api4com-call-event';
const target = { webhookUrl: N8N, webhookVersion: 'v1.4' };

const sippulse = {
  id: 67917,
  gateway: 'sippulse',
  webhook: true,
  webhookConstraint: { metadata: { gateway: 'sippulse' } },
  metadata: { domain: 'mendezco.api4com.com', password: 'x', webhookUrl: 'https://app/api/webhooks/api4com?token=t' },
};
const marsVoip = { id: 154527, gateway: 'mars-voip', webhook: true, webhookConstraint: null, metadata: {} };

describe('planCallWebhookIntegration', () => {
  it('conta sem integração `webhook` (Julio 1023/1000) → cria, sem id e sem filtro', () => {
    const plan = planCallWebhookIntegration([sippulse, marsVoip], target);
    expect(plan).toEqual({
      action: 'create',
      body: {
        gateway: 'webhook',
        webhook: true,
        metadata: { webhookUrl: N8N, webhookVersion: 'v1.4', webhookTypes: ['channel-hangup', 'channel-answer'] },
      },
    });
  });

  it('integração `webhook` com URL errada (Julio 1025: editor do n8n) → atualiza a MESMA, preservando o resto', () => {
    const wrong = {
      id: 163813,
      gateway: 'webhook',
      webhook: true,
      webhookConstraint: null,
      metadata: {
        webhookUrl: 'https://n8n.v4companyamaral.com/workflow/tXz0q6ahd06lvXaz',
        webhookVersion: 'v1.8',
        webhookTypes: ['channel-hangup', 'channel-answer'],
      },
    };
    const plan = planCallWebhookIntegration([sippulse, wrong], target);
    expect(plan).toEqual({
      action: 'update',
      integrationId: 163813,
      body: {
        id: 163813,
        gateway: 'webhook',
        webhook: true,
        metadata: { webhookUrl: N8N, webhookVersion: 'v1.4', webhookTypes: ['channel-hangup', 'channel-answer'] },
      },
    });
  });

  it('já configurada igual à da Amaral → não faz nada', () => {
    const ok = {
      id: 120423,
      gateway: 'webhook',
      webhook: true,
      webhookConstraint: null,
      metadata: { webhookUrl: N8N, webhookVersion: 'v1.4', webhookTypes: ['channel-answer', 'channel-hangup'] },
    };
    expect(planCallWebhookIntegration([ok], target)).toEqual({ action: 'noop', integrationId: 120423 });
  });

  it('integração `webhook` desligada ou com filtro → atualiza e limpa o filtro', () => {
    const filtered = {
      id: 9,
      gateway: 'webhook',
      webhook: false,
      webhookConstraint: { metadata: { gateway: 'x' } },
      metadata: { webhookUrl: N8N, webhookVersion: 'v1.4', webhookTypes: ['channel-hangup', 'channel-answer'] },
    };
    const plan = planCallWebhookIntegration([filtered], target);
    expect(plan.action).toBe('update');
    if (plan.action === 'update') {
      expect(plan.body.webhook).toBe(true);
      expect(plan.body.webhookConstraint).toEqual({});
    }
  });

  it('nunca planeja mexer em integração de outro gateway', () => {
    const plan = planCallWebhookIntegration([sippulse, marsVoip], target);
    expect(JSON.stringify(plan)).not.toContain('67917');
    expect(JSON.stringify(plan)).not.toContain('154527');
  });
});

describe('isValidCallWebhookUrl', () => {
  it('só https', () => {
    expect(isValidCallWebhookUrl(N8N)).toBe(true);
    expect(isValidCallWebhookUrl('http://webhook-n8n.v4companyamaral.com/x')).toBe(false);
    expect(isValidCallWebhookUrl('não é url')).toBe(false);
    expect(isValidCallWebhookUrl(undefined)).toBe(false);
  });
});
