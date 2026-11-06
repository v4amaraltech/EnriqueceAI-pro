import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consumeOAuthState: vi.fn(),
  handleCrmCallback: vi.fn(),
}));

vi.mock('@/lib/security/oauth-state', () => ({ consumeOAuthState: mocks.consumeOAuthState }));
vi.mock('@/features/integrations/actions/manage-crm', () => ({ handleCrmCallback: mocks.handleCrmCallback }));

import { GET } from './route';

const call = (qs: string) => GET(new Request(`https://app.test/api/v2/callback?${qs}`));

describe('GET /API/v2/callback (Pipedrive)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleCrmCallback.mockResolvedValue({ success: true });
  });

  it('recusa sem trocar o code quando o state não confere', async () => {
    mocks.consumeOAuthState.mockResolvedValue(false);

    const res = await call('code=abc&state=forjado');

    expect(mocks.consumeOAuthState).toHaveBeenCalledWith('pipedrive', 'forjado');
    expect(mocks.handleCrmCallback).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toContain('error=oauth_state_mismatch');
  });

  it('recusa quando o state nem veio (link montado por terceiro)', async () => {
    mocks.consumeOAuthState.mockResolvedValue(false);

    await call('code=abc');

    expect(mocks.consumeOAuthState).toHaveBeenCalledWith('pipedrive', null);
    expect(mocks.handleCrmCallback).not.toHaveBeenCalled();
  });

  it('com state válido, troca o code e conecta', async () => {
    mocks.consumeOAuthState.mockResolvedValue(true);

    const res = await call('code=abc&state=ok');

    expect(mocks.handleCrmCallback).toHaveBeenCalledWith('pipedrive', 'abc');
    expect(res.headers.get('location')).toContain('success=pipedrive_connected');
  });
});
