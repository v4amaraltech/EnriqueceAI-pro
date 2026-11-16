import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isCockpitAutoDialEnabled } from '@/features/cockpit/services/cockpit-auto-dial-flag';
import { getSdrPaceData } from '@/features/dashboard/actions/get-sdr-pace-data';
import { fetchNextCallCard } from '@/features/cockpit/services/next-call-card.service';
import type { CockpitViewer } from '@/features/cockpit/types';

import CockpitPage from './page';

vi.mock('@/features/cockpit/services/resolve-cockpit-viewer', () => ({ resolveCockpitViewer: vi.fn() }));
vi.mock('@/features/cockpit/services/cockpit-auto-dial-flag', () => ({ isCockpitAutoDialEnabled: vi.fn(), isCockpitAutoDialLive: vi.fn() }));
vi.mock('@/features/dashboard/actions/get-sdr-pace-data', () => ({ getSdrPaceData: vi.fn() }));
vi.mock('@/features/cockpit/services/next-call-card.service', () => ({ fetchNextCallCard: vi.fn() }));

const viewer: CockpitViewer = { viewerId: 'u1', orgId: 'o1', isManager: false, targetUserId: 'u1', targetName: 'Bia', sdrOptions: [] };

describe('página do Cockpit', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resolveCockpitViewer } = await import('@/features/cockpit/services/resolve-cockpit-viewer');
    vi.mocked(resolveCockpitViewer).mockResolvedValue(viewer);
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(false);
  });

  it.each(['tarefas', 'leads', 'closers', 'metas', 'dashboard'])('aba %s não passa o cartão "Próxima ligação" ao shell nem busca o próximo lead', async (tab) => {
    const element = await CockpitPage({ searchParams: Promise.resolve({ tab }) });
    expect(element.props.callCard).toBeUndefined();
    expect(fetchNextCallCard).not.toHaveBeenCalled();
  });

  it('flag do motor desligada: o menu segue levando à Execução e ?tab=discador cai em tarefas', async () => {
    const element = await CockpitPage({ searchParams: Promise.resolve({ tab: 'discador' }) });
    expect(element.props.dialerTabEnabled).toBe(false);
    expect(element.props.tab).toBe('tarefas');
  });

  it('flag do motor ligada para o próprio usuário: abre a aba Discador', async () => {
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(true);
    const element = await CockpitPage({ searchParams: Promise.resolve({ tab: 'discador' }) });
    expect(element.props.dialerTabEnabled).toBe(true);
    expect(element.props.tab).toBe('discador');
    expect(isCockpitAutoDialEnabled).toHaveBeenCalledWith({ orgId: 'o1', userId: 'u1' });
  });

  it('gestor olhando outro SDR: aba Discador não aparece nem lê a flag', async () => {
    const { resolveCockpitViewer } = await import('@/features/cockpit/services/resolve-cockpit-viewer');
    vi.mocked(resolveCockpitViewer).mockResolvedValue({ ...viewer, isManager: true, targetUserId: 'sdr-9' });
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(true);
    const element = await CockpitPage({ searchParams: Promise.resolve({ tab: 'discador', sdr: 'sdr-9' }) });
    expect(element.props.dialerTabEnabled).toBe(false);
    expect(element.props.tab).toBe('tarefas');
    expect(isCockpitAutoDialEnabled).not.toHaveBeenCalled();
  });

  async function dashboardElement(v: CockpitViewer) {
    const { resolveCockpitViewer } = await import('@/features/cockpit/services/resolve-cockpit-viewer');
    vi.mocked(resolveCockpitViewer).mockResolvedValue(v);
    const page = await CockpitPage({ searchParams: Promise.resolve({ tab: 'dashboard' }) });
    const content = page.props.children;
    const server = await content.type(content.props);
    return server.type(server.props);
  }

  it('Dashboard: gestor no próprio Cockpit não busca ritmo (evita números de outro SDR) e mostra o estado vazio', async () => {
    const el = await dashboardElement({ ...viewer, isManager: true, targetUserId: 'u1' });
    expect(getSdrPaceData).not.toHaveBeenCalled();
    expect(el.props.managerOwn).toBe(true);
    expect(el.props.sdrPace).toBeNull();
  });

  it('Dashboard: gestor vendo um SDR segue buscando o ritmo desse SDR', async () => {
    vi.mocked(getSdrPaceData).mockResolvedValue({ success: false, error: 'x' });
    const el = await dashboardElement({ ...viewer, isManager: true, targetUserId: 'sdr-9' });
    expect(getSdrPaceData).toHaveBeenCalledWith(expect.objectContaining({ userId: 'sdr-9' }));
    expect(el.props.managerOwn).toBeUndefined();
  });

  it('Dashboard: SDR segue buscando o próprio ritmo', async () => {
    vi.mocked(getSdrPaceData).mockResolvedValue({ success: false, error: 'x' });
    const el = await dashboardElement(viewer);
    expect(getSdrPaceData).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
    expect(el.props.managerOwn).toBeUndefined();
  });
});
