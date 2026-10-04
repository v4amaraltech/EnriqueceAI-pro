import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  captureMessage: vi.fn(),
  states: {} as Record<string, unknown>,
}));

vi.mock('@sentry/nextjs', () => ({ captureMessage: mocks.captureMessage, captureException: vi.fn() }));
vi.mock('@/lib/auth/verify-cron-secret', () => ({ verifyCronSecret: () => true }));
vi.mock('@/lib/supabase/from', () => ({
  from: (client: { from: (t: string) => unknown }, table: string) => client.from(table),
}));
vi.mock('@/features/notifications/services/notification.service', () => ({
  createNotificationsForOrgMembers: (p: unknown) => mocks.notify(p),
}));

function chain(table: string) {
  const filters: Record<string, unknown> = {};
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'like', 'gte', 'lte', 'limit', 'in', 'is']) c[m] = vi.fn().mockReturnValue(c);
  c.eq = vi.fn((col: string, val: unknown) => {
    filters[col] = val;
    return c;
  });
  const result = () => {
    if (table === 'worker_run_state') return { data: mocks.states[filters.job_name as string] ?? null };
    if (table === 'organizations') return { data: [{ id: 'org-1' }, { id: 'org-sem-email' }] };
    // Só org-1 usa e-mail automático / Gmail / BDR.
    if (table === 'cadences' || table === 'gmail_connections') return { data: [{ org_id: 'org-1' }] };
    if (table === 'notifications') return { data: null }; // sem alerta recente
    if (table === 'calls') return { count: 0 };
    return { data: null };
  };
  c.maybeSingle = vi.fn(() => Promise.resolve(result()));
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return c;
}

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({ from: (t: string) => chain(t) }) }));

import { POST } from './route';

const req = () => new Request('https://x/api/cron/health-check-workers', { method: 'POST' });
const ok = (hoursAgo: number) => ({
  last_run_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
  last_success_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
  last_status: 'success',
  metadata: {},
});

type Summary = Array<{ job: string; status: string; alerted: boolean }>;
const run = async () => ((await (await POST(req())).json()) as { summary: Summary }).summary;
const byJob = (s: Summary, job: string) => s.find((x) => x.job === job);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notify.mockResolvedValue(undefined);
  mocks.states = { 'reconcile-api4com-calls': ok(0.5) };
});
afterEach(() => vi.useRealTimers());

describe('health-check-workers — robôs vigiados', () => {
  it('detecção de respostas parada há 3h: avisa gestores e Sentry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T15:00:00Z')); // segunda, 12h BRT
    mocks.states['reconcile-api4com-calls'] = ok(0.5);
    mocks.states['check-email-replies'] = ok(3);
    mocks.states['ingest-email-inbox'] = ok(0.1);
    mocks.states['execute-cadence-steps'] = ok(0.1);

    const s = await run();

    expect(byJob(s, 'check-email-replies')).toMatchObject({ status: 'stale', alerted: true });
    expect(byJob(s, 'ingest-email-inbox')).toMatchObject({ status: 'healthy' });
    // Só a org que usa e-mail é avisada, com texto de impacto (sem jargão de "worker").
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        title: 'Detecção de respostas de e-mail parado',
        resourceId: 'check-email-replies',
        body: expect.stringContaining('Respostas de leads por e-mail podem não estar sendo detectadas'),
      }),
    );
    expect(mocks.notify.mock.calls[0]![0].body).not.toContain('worker');
    expect(mocks.captureMessage).toHaveBeenCalledWith(
      '[health-check] worker check-email-replies stale',
      expect.objectContaining({ tags: { worker: 'check-email-replies' } }),
    );
  });

  it('motor de cadência fora do horário (domingo) não é cobrado', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T15:00:00Z')); // domingo
    mocks.states['reconcile-api4com-calls'] = ok(0.5);
    mocks.states['execute-cadence-steps'] = ok(40); // última rodada na sexta
    mocks.states['check-email-replies'] = ok(0.1);
    mocks.states['ingest-email-inbox'] = ok(0.1);

    const s = await run();

    expect(byJob(s, 'execute-cadence-steps')).toMatchObject({ status: 'off_hours', alerted: false });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('motor de cadência parado em horário comercial: avisa', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T16:00:00Z')); // segunda, 13h BRT
    mocks.states['reconcile-api4com-calls'] = ok(0.5);
    mocks.states['execute-cadence-steps'] = ok(2);
    mocks.states['check-email-replies'] = ok(0.1);
    mocks.states['ingest-email-inbox'] = ok(0.1);

    const s = await run();

    expect(byJob(s, 'execute-cadence-steps')).toMatchObject({ status: 'stale', alerted: true });
  });

  it('robô recém-vigiado sem registro ainda (logo após o deploy) não dispara alerta', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T16:00:00Z'));
    mocks.states = { 'reconcile-api4com-calls': ok(0.5) }; // nenhum estado para os 3 novos

    const s = await run();

    for (const job of ['execute-cadence-steps', 'check-email-replies', 'ingest-email-inbox']) {
      expect(byJob(s, job)).toMatchObject({ status: 'not_tracked_yet', alerted: false });
    }
    expect(mocks.notify).not.toHaveBeenCalled();
    // ...mas o time fica sabendo (se persistir, o robô está rodando sem vigilância).
    expect(mocks.captureMessage).toHaveBeenCalledWith(
      '[health-check] worker check-email-replies has no run state yet',
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('API4COM sem registro continua alertando todas as orgs (comportamento antigo)', async () => {
    mocks.states = {};
    const s = await run();
    expect(byJob(s, 'reconcile-api4com-calls')).toMatchObject({ status: 'stale', alerted: true });
    const api4comOrgs = mocks.notify.mock.calls
      .map((c) => c[0] as { orgId: string; resourceId: string })
      .filter((p) => p.resourceId === 'reconcile-api4com-calls')
      .map((p) => p.orgId);
    expect(api4comOrgs).toEqual(['org-1', 'org-sem-email']);
  });
});
