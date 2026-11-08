import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ flag: vi.fn() }));
vi.mock('../services/flag-scope.service', () => ({ isScopedFlagEnabled: mocks.flag }));

import { EDGE_INGESTION_FLAG_KEY, isEdgeIngestionEnabled } from './edge-ingestion.service';

describe('flag edge_ingestion_v1', () => {
  beforeEach(() => mocks.flag.mockReset());

  it('usa flag-scope com a organização e erro vira desligado', async () => {
    mocks.flag.mockResolvedValue(false);
    expect(await isEdgeIngestionEnabled('org-1')).toBe(false);
    expect(mocks.flag).toHaveBeenCalledWith(EDGE_INGESTION_FLAG_KEY, { orgId: 'org-1' });
    expect(EDGE_INGESTION_FLAG_KEY).toBe('edge_ingestion_v1');
  });
});
