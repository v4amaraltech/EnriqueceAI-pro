import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CadenceStepMetrics } from '../../types/step-analytics';
import { CadenceStepTable } from '../CadenceStepTable';

const mockSteps: CadenceStepMetrics[] = [
  {
    stepId: 's1',
    stepOrder: 1,
    channel: 'email',
    activityName: 'Intro Email',
    sent: 100,
    opened: 50,
    clicked: 10,
    replied: 5,
    meetingScheduled: 1,
    openRate: 50,
    clickRate: 10,
    replyRate: 5,
  },
  {
    stepId: 's2',
    stepOrder: 2,
    channel: 'phone',
    activityName: null,
    sent: 0,
    opened: 0,
    clicked: 0,
    replied: 0,
    meetingScheduled: 0,
    openRate: 0,
    clickRate: 0,
    replyRate: 0,
  },
];

describe('CadenceStepTable', () => {
  it('shows loading skeletons when isLoading is true', () => {
    const { container } = render(<CadenceStepTable steps={[]} isLoading={true} />);
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
  });

  it('shows empty state when no steps', () => {
    render(<CadenceStepTable steps={[]} isLoading={false} />);
    expect(screen.getByText(/nenhum step/i)).toBeInTheDocument();
  });

  it('renders step rows with correct data', () => {
    render(<CadenceStepTable steps={mockSteps} isLoading={false} />);

    // Step 1
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText(/Intro Email/)).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();

    // Step 2 with zeros is still rendered (AC #6)
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('Telefone')).toBeInTheDocument();
  });

  it('displays rates inline with counts', () => {
    render(<CadenceStepTable steps={mockSteps} isLoading={false} />);

    // Check that rate percentages are present
    expect(screen.getByText('(50%)')).toBeInTheDocument(); // openRate
    expect(screen.getByText('(10%)')).toBeInTheDocument(); // clickRate
    expect(screen.getByText('(5%)')).toBeInTheDocument(); // replyRate
  });
});
