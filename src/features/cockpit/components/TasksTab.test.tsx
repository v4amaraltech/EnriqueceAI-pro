import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingActivity } from '@/features/activities/types';
import { EMPTY_GUARDRAILS } from '@/features/activities/utils/daily-guardrails';

import { FIXTURE_ACTIVITY } from '@/app/demo/call-workspace/fixture';

import { TasksTab } from './TasksTab';

const { executeActivity } = vi.hoisted(() => ({
  executeActivity: vi.fn(async () => ({ success: true, data: { interactionId: 'int-1' } })),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/features/activities/components/ActivityExecutionSheet', () => ({
  ActivityExecutionSheet: ({ selectedKey }: { selectedKey: string | null }) => (
    <div data-testid="execution-sheet">{selectedKey ?? 'closed'}</div>
  ),
}));
vi.mock('./CallSidePanel', () => ({
  CallSidePanel: ({ activity }: { activity: PendingActivity }) => (
    <aside data-testid="call-side-panel">{activity.lead.nome_fantasia}</aside>
  ),
}));
vi.mock('@/features/activities/actions/execute-activity', () => ({ executeActivity }));

const emailActivity: PendingActivity = {
  ...FIXTURE_ACTIVITY,
  enrollmentId: '77777777-7777-4777-8777-777777777777',
  stepId: '88888888-8888-4888-8888-888888888888',
  channel: 'email',
  activityName: 'E-mail - Dia 1',
};

function renderTab(activities: PendingActivity[]) {
  return render(
    <TasksTab
      initialActivities={activities}
      progress={{ completed: 0, pending: activities.length, total: activities.length, target: 20, guardrails: EMPTY_GUARDRAILS }}
      autoSend={null}
      isOwn
      dialerProvider="api4com"
      targetUserId="55555555-5555-4555-8555-555555555555"
    />,
  );
}

describe('TasksTab painel de ligação', () => {
  beforeEach(() => {
    executeActivity.mockClear();
  });

  it('abre o painel lateral e mantém a tabela visível', () => {
    renderTab([FIXTURE_ACTIVITY, emailActivity]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Executar tarefa' })[0]!);
    expect(screen.getByTestId('call-side-panel').textContent).toContain('Empresa Fixture Ltda');
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByTestId('execution-sheet').textContent).toBe('closed');
  });

  it('e-mail continua na gaveta, não no painel de ligação', () => {
    renderTab([emailActivity]);
    fireEvent.click(screen.getByRole('button', { name: 'Executar tarefa' }));
    expect(screen.queryByTestId('call-side-panel')).toBeNull();
    expect(screen.getByTestId('execution-sheet').textContent).toContain(emailActivity.enrollmentId);
  });

  it('concluir a ligação registra a atividade uma vez', async () => {
    renderTab([FIXTURE_ACTIVITY]);
    const conclude = screen.getByRole('button', { name: 'Concluir tarefa' });
    fireEvent.click(conclude);
    fireEvent.click(conclude);
    await waitFor(() => expect(executeActivity).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Empresa Fixture Ltda')).toBeNull();
  });
});
