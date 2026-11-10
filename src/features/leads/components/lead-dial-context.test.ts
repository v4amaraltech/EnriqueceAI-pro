import { describe, expect, it } from 'vitest';

import { contextForSuccessfulLeadCall } from './lead-dial-context';

const lead = { id: '969ea854-1724-4f22-85a3-3633cd314553', nome_fantasia: 'Mercante Net', razao_social: null };

describe('contextForSuccessfulLeadCall', () => {
  it('sucesso publica a ligação nova, com o telefone discado e sem dono de modal', () => {
    expect(
      contextForSuccessfulLeadCall(
        { success: true, data: { callId: 'adb23762-4673-4663-a9ed-5d1855f4f04d', providerCallId: 'prov-b' } },
        lead,
        '11954958486',
        'token-b',
      ),
    ).toEqual({
      callId: 'adb23762-4673-4663-a9ed-5d1855f4f04d',
      providerCallId: 'prov-b',
      leadId: lead.id,
      leadName: 'Mercante Net',
      phone: '11954958486',
      ownerHandlesResult: false,
      dialToken: 'token-b',
    });
  });

  it('falha do POST não publica contexto e portanto não substitui o resultado pendente', () => {
    expect(contextForSuccessfulLeadCall({ success: false, error: 'ramal ocupado' }, lead, '11954958486', 'token-b')).toBeNull();
  });
});
