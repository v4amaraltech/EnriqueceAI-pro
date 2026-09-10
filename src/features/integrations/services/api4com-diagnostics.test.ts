import { describe, expect, it } from 'vitest';

import {
  describeWebhookUrl,
  dialerPassesWebhookConstraint,
  summarizeIntegration,
  summarizeRecentCall,
} from './api4com-diagnostics';

const ORG = '0bbf24f6-e4f4-4cc3-92ac-0301d8b31144';

describe('describeWebhookUrl', () => {
  it('nunca devolve o token da query string', () => {
    const out = describeWebhookUrl('https://app.enriqueceai.com.br/api/webhooks/api4com?token=SEGREDO123');
    expect(out).toEqual({ host: 'app.enriqueceai.com.br', path: '/api/webhooks/api4com', hasToken: true });
    expect(JSON.stringify(out)).not.toContain('SEGREDO123');
  });

  it('lida com ausência e URL inválida', () => {
    expect(describeWebhookUrl(undefined)).toBeNull();
    expect(describeWebhookUrl('não é url')).toEqual({ host: '(url inválida)', path: '', hasToken: false });
  });
});

describe('summarizeIntegration', () => {
  const raw = {
    id: 42,
    gateway: 'enriqueceai',
    webhook: true,
    webhookConstraint: { metadata: { gateway: 'enriqueceai' } },
    metadata: {
      webhookUrl: 'https://app.enriqueceai.com.br/api/webhooks/api4com?token=SEGREDO123',
      webhookTypes: ['channel-hangup', 'channel-answer'],
      webhookVersion: 'v1.4',
      apiKey: 'NAO-PODE-VAZAR',
      domain: 'v4amaral.api4com.com',
    },
  };

  it('resume os campos que importam, sem valores sensíveis de metadata', () => {
    const out = summarizeIntegration(raw);
    expect(out).toMatchObject({
      id: 42,
      gateway: 'enriqueceai',
      webhookEnabled: true,
      constraintGateway: 'enriqueceai',
      webhookTypes: ['channel-hangup', 'channel-answer'],
      webhookVersion: 'v1.4',
      accountDomain: 'v4amaral.api4com.com',
      metadataKeys: ['apiKey', 'domain', 'webhookTypes', 'webhookUrl', 'webhookVersion'],
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('SEGREDO123');
    expect(serialized).not.toContain('NAO-PODE-VAZAR');
  });

  it('aponta quando o filtro do webhook barra o gateway do discador (flux-{orgId})', () => {
    expect(dialerPassesWebhookConstraint(summarizeIntegration(raw), ORG)).toBe(false);
    const ok = summarizeIntegration({ ...raw, webhookConstraint: { metadata: { gateway: `flux-${ORG}` } } });
    expect(dialerPassesWebhookConstraint(ok, ORG)).toBe(true);
    const semFiltro = summarizeIntegration({ ...raw, webhookConstraint: null });
    expect(dialerPassesWebhookConstraint(semFiltro, ORG)).toBeNull();
  });

  it('não quebra com payload inesperado', () => {
    expect(summarizeIntegration(null)).toMatchObject({ gateway: null, webhookEnabled: null, metadataKeys: [] });
  });
});

describe('summarizeRecentCall', () => {
  it('traz o gateway gravado na ligação e omite número de destino e link de gravação', () => {
    const out = summarizeRecentCall({
      id: 'c1',
      from: '1023',
      to: '5511999998888',
      started_at: '2026-09-10 15:22:00',
      duration: 31,
      hangup_cause: 'NORMAL_CLEARING',
      record_url: 'https://rec.example/abc',
      metadata: { gateway: `flux-${ORG}` },
    });
    expect(out).toEqual({
      id: 'c1',
      from: '1023',
      started_at: '2026-09-10 15:22:00',
      duration: 31,
      hangup_cause: 'NORMAL_CLEARING',
      gateway: `flux-${ORG}`,
      hasRecording: true,
    });
  });
});
