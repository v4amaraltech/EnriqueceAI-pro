import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TrialBanner } from '../TrialBanner';

describe('TrialBanner', () => {
  it('shows days remaining', () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    render(<TrialBanner periodEnd={futureDate} />);

    expect(screen.getByText(/5/)).toBeInTheDocument();
    expect(screen.getByText(/dias restantes/)).toBeInTheDocument();
  });

  it('shows singular day when 1 day left', () => {
    const tomorrow = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
    render(<TrialBanner periodEnd={tomorrow} />);

    expect(screen.getByText(/dia restante/)).toBeInTheDocument();
  });

  it('shows 0 days when expired', () => {
    const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    render(<TrialBanner periodEnd={pastDate} />);

    expect(screen.getByText(/0/)).toBeInTheDocument();
  });

  it('renders upgrade link', () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    render(<TrialBanner periodEnd={futureDate} />);

    const link = screen.getByRole('link', { name: /fazer upgrade/i });
    expect(link).toHaveAttribute('href', '/upgrade');
  });
});
