import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchNextCallCard } from '@/features/cockpit/services/next-call-card.service';
import type { CockpitViewer } from '@/features/cockpit/types';

import CockpitPage from './page';

vi.mock('@/features/cockpit/services/resolve-cockpit-viewer', () => ({ resolveCockpitViewer: vi.fn() }));
vi.mock('@/features/cockpit/services/next-call-card.service', () => ({ fetchNextCallCard: vi.fn() }));

const viewer: CockpitViewer = { viewerId: 'u1', orgId: 'o1', isManager: false, targetUserId: 'u1', targetName: 'Bia', sdrOptions: [] };

describe('página do Cockpit', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resolveCockpitViewer } = await import('@/features/cockpit/services/resolve-cockpit-viewer');
    vi.mocked(resolveCockpitViewer).mockResolvedValue(viewer);
  });

  it.each(['tarefas', 'leads', 'closers', 'metas', 'dashboard'])('aba %s não passa o cartão "Próxima ligação" ao shell nem busca o próximo lead', async (tab) => {
    const element = await CockpitPage({ searchParams: Promise.resolve({ tab }) });
    expect(element.props.callCard).toBeUndefined();
    expect(fetchNextCallCard).not.toHaveBeenCalled();
  });
});
