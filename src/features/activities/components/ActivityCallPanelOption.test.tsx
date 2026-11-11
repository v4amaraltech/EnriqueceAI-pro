import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { FIXTURE_ACTIVITY } from '@/app/demo/call-workspace/fixture';
import { EMPTY_GUARDRAILS } from '@/features/activities/utils/daily-guardrails';

import { ActivityQueueView } from './ActivityQueueView';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock('./ActivityExecutionSheet', () => ({
  ActivityExecutionSheet: ({ selectedKey }: { selectedKey: string | null }) => (
    <div data-testid="execution-sheet">{selectedKey ?? 'closed'}</div>
  ),
}));
vi.mock('@/features/cockpit/components/CallSidePanel', () => ({
  CallSidePanel: () => <aside data-testid="call-side-panel" />,
}));
vi.mock('@/features/leads/components/MarkLeadLostDialog', () => ({ MarkLeadLostDialog: () => null }));
vi.mock('@/features/leads/components/EnrollInCadenceDialog', () => ({ EnrollInCadenceDialog: () => null }));
vi.mock('./StartNewLeadsModal', () => ({ StartNewLeadsModal: () => null }));
vi.mock('./SkipStepReasonDialog', () => ({ SkipStepReasonDialog: () => null }));

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function renderQueue(leadCardEnabled: boolean) {
  return render(
    <ActivityQueueView
      initialActivities={[FIXTURE_ACTIVITY]}
      progress={{ completed: 0, pending: 1, total: 1, target: 20, guardrails: EMPTY_GUARDRAILS }}
      leadCardEnabled={leadCardEnabled}
    />,
  );
}

describe('execução pela lista de atividades', () => {
  it('com a flag desligada Executar abre a gaveta e não o painel', async () => {
    const user = userEvent.setup();
    renderQueue(false);
    await user.click(screen.getByRole('button', { name: 'Executar' }));
    expect(screen.getByTestId('execution-sheet').textContent).not.toBe('closed');
    expect(screen.queryByTestId('call-side-panel')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    expect(screen.queryByRole('menuitem', { name: 'Abrir painel lateral' })).toBeNull();
  });

  it('com a flag ligada Executar abre o painel e deixa a gaveta fechada', async () => {
    const user = userEvent.setup();
    renderQueue(true);
    await user.click(screen.getByRole('button', { name: 'Executar' }));
    expect(screen.getByTestId('call-side-panel')).toBeTruthy();
    expect(screen.getByTestId('execution-sheet').textContent).toBe('closed');
  });
});
