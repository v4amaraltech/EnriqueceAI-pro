import { describe, expect, it } from 'vitest';

import {
  isValidCallWebhookUrl,
  planCallWebhookIntegration,
  planCallWebhookRepair,
} from './api4com-call-webhook';

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

describe('planCallWebhookRepair (cron diário / cadastro de ramal)', () => {
  const amocrm = {
    id: 40309,
    gateway: 'amocrm',
    webhook: true,
    webhookConstraint: { metadata: { gateway: 'amocrm' } },
    metadata: { webhookUrl: 'https://app.enriqueceai.com.br/api/webhooks/api4com?token=t' },
  };
  const salesforce = { id: 93919, gateway: 'salesforce', webhook: true, metadata: { subdomain: 'v4' } };

  it('conta sem `webhook` (ex.: Amaral 1040) → cria, e não toca em CRM', () => {
    const plan = planCallWebhookRepair([sippulse, amocrm, salesforce], target);
    expect(plan.action).toBe('create');
    const s = JSON.stringify(plan);
    for (const id of ['67917', '40309', '93919']) expect(s).not.toContain(id);
  });

  it('`webhook` já ok → nada, mesmo com versão/URL diferentes do padrão (não mexe no que funciona)', () => {
    const v18 = {
      id: 119473,
      gateway: 'webhook',
      webhook: true,
      webhookConstraint: null,
      metadata: { webhookUrl: N8N, webhookVersion: 'v1.8', webhookTypes: ['channel-hangup', 'channel-answer'] },
    };
    expect(planCallWebhookRepair([amocrm, v18], target)).toEqual({
      action: 'noop',
      integrationId: 119473,
      urlIsDefault: true,
    });
  });

  it('URL diferente do padrão (ex.: editor do n8n) → NÃO troca, só sinaliza', () => {
    const wrong = {
      id: 163813,
      gateway: 'webhook',
      webhook: true,
      webhookConstraint: null,
      metadata: {
        webhookUrl: 'https://n8n.v4companyamaral.com/workflow/x',
        webhookVersion: 'v1.8',
        webhookTypes: ['channel-hangup', 'channel-answer'],
      },
    };
    expect(planCallWebhookRepair([wrong], target)).toMatchObject({ action: 'noop', urlIsDefault: false });
  });

  it('`webhook` desligada / com filtro / sem os 2 tipos → repara mantendo URL e versão', () => {
    const broken = {
      id: 7,
      gateway: 'webhook',
      webhook: false,
      webhookConstraint: { metadata: { gateway: 'x' } },
      metadata: { webhookUrl: 'https://outro.exemplo/hook', webhookVersion: 'v1.8', webhookTypes: ['channel-hangup'] },
    };
    const plan = planCallWebhookRepair([broken], target);
    expect(plan).toEqual({
      action: 'repair',
      integrationId: 7,
      urlIsDefault: false,
      body: {
        id: 7,
        gateway: 'webhook',
        webhook: true,
        webhookConstraint: {},
        metadata: {
          webhookUrl: 'https://outro.exemplo/hook',
          webhookVersion: 'v1.8',
          webhookTypes: ['channel-hangup', 'channel-answer'],
        },
      },
    });
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
