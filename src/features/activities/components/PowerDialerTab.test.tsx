import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/shared/components/ui/tooltip';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';
import type { DialerPreferences, DialerStats } from '../schemas/dialer-preferences.schemas';

import { PowerDialerTab } from './PowerDialerTab';

// Mock useOrganization for idle layout
vi.mock('@/features/auth/hooks/useOrganization', () => ({
  useOrganization: () => ({ isManager: true, organization: {}, currentMember: {}, members: [], loading: false }),
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function renderWithProvider(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const defaultStats: DialerStats = {
  leadsWithoutPhone: 1,
  leadsAtDailyLimit: 0,
  leadsWithSnooze: 0,
  totalAvailable: 2,
};

const defaultPrefs: DialerPreferences = {
  simultaneous_phones: 2,
  daily_limit_per_lead: 3,
};

const mockQueue: DialerQueueItem[] = [
  {
    enrollmentId: 'e1',
    leadId: 'l1',
    leadName: 'Maria Silva',
    firstName: 'Maria',
    lastName: 'Silva',
    companyName: 'Silva Ltda',
    phone: '(11) 99999-1234',
    phones: [{ formatted: '(11) 99999-1234', raw: '5511999991234', label: '(11) 99999-1234' }],
    cadenceName: 'Cadencia Teste',
    cadenceId: 'c1',
    stepId: 's1',
    stepOrder: 1,
    totalSteps: 3,
    nextStepDue: '2026-02-23T10:00:00Z',
    activityName: null,
    callScript: null,
  },
  {
    enrollmentId: 'e2',
    leadId: 'l2',
    leadName: 'Joao Santos',
    firstName: 'Joao',
    lastName: 'Santos',
    companyName: 'Santos SA',
    phone: '(21) 98765-4321',
    phones: [{ formatted: '(21) 98765-4321', raw: '5521987654321', label: '(21) 98765-4321' }],
    cadenceName: 'Cadencia Teste',
    cadenceId: 'c1',
    stepId: 's2',
    stepOrder: 1,
    totalSteps: 3,
    nextStepDue: '2026-02-23T11:00:00Z',
    activityName: null,
    callScript: null,
  },
  {
    enrollmentId: 'e3',
    leadId: 'l3',
    leadName: 'Ana Costa',
    firstName: 'Ana',
    lastName: 'Costa',
    companyName: 'Costa ME',
    phone: null,
    phones: [],
    cadenceName: 'Cadencia Teste',
    cadenceId: 'c1',
    stepId: 's3',
    stepOrder: 2,
    totalSteps: 3,
    nextStepDue: '2026-02-23T12:00:00Z',
    activityName: null,
    callScript: null,
  },
];

describe('PowerDialerTab', () => {
  it('renders idle layout with Power Dialer heading', () => {
    renderWithProvider(
      <PowerDialerTab initialQueue={mockQueue} stats={defaultStats} preferences={defaultPrefs} />,
    );
    expect(screen.getByText('Power Dialer')).toBeInTheDocument();
  });

  it('renders start button in idle state', () => {
    renderWithProvider(
      <PowerDialerTab initialQueue={mockQueue} stats={defaultStats} preferences={defaultPrefs} />,
    );
    expect(screen.getByText('Iniciar ligacoes')).toBeInTheDocument();
  });

  it('renders sidebar preferences', () => {
    renderWithProvider(
      <PowerDialerTab initialQueue={mockQueue} stats={defaultStats} preferences={defaultPrefs} />,
    );
    expect(screen.getByText('Preferencias')).toBeInTheDocument();
    expect(screen.getByText('Telefones simultaneos')).toBeInTheDocument();
    expect(screen.getByText('Limite diario por lead')).toBeInTheDocument();
  });

  it('renders sidebar stats', () => {
    renderWithProvider(
      <PowerDialerTab initialQueue={mockQueue} stats={defaultStats} preferences={defaultPrefs} />,
    );
    // "Sem telefone" appears in sidebar stats and on the lead card with null phone
    expect(screen.getAllByText('Sem telefone').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Total disponivel')).toBeInTheDocument();
  });

  it('renders lead cards in grid', () => {
    renderWithProvider(
      <PowerDialerTab initialQueue={mockQueue} stats={defaultStats} preferences={defaultPrefs} />,
    );
    expect(screen.getByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByText('Joao Santos')).toBeInTheDocument();
    expect(screen.getByText('Ana Costa')).toBeInTheDocument();
  });

  it('renders empty idle layout when no queue', () => {
    renderWithProvider(
      <PowerDialerTab initialQueue={[]} stats={defaultStats} preferences={defaultPrefs} />,
    );
    expect(screen.getByText('Power Dialer')).toBeInTheDocument();
    const startBtn = screen.getByText('Iniciar ligacoes');
    expect(startBtn.closest('button')).toBeDisabled();
  });
});
