import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { TrialBanner } from '../TrialBanner';

describe('TrialBanner', () => {
  it('renders the countdown message with plural days', () => {
    render(<TrialBanner daysRemaining={15} />);

    expect(screen.getByText(/Seu trial expira em 15 dias/)).toBeInTheDocument();
  });

  it('renders singular day label when 1 day remaining', () => {
    render(<TrialBanner daysRemaining={1} />);

    expect(screen.getByText(/Seu trial expira em 1 dia/)).toBeInTheDocument();
  });

  it('renders the upgrade CTA link pointing to billing', () => {
    render(<TrialBanner daysRemaining={10} />);

    const link = screen.getByText('Fazer upgrade');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/settings/billing');
  });

  it('uses amber styling for > 7 days remaining', () => {
    const { container } = render(<TrialBanner daysRemaining={15} />);

    const banner = container.firstElementChild;
    expect(banner?.className).toContain('bg-amber-50');
  });

  it('uses orange styling for 3-7 days remaining', () => {
    const { container } = render(<TrialBanner daysRemaining={5} />);

    const banner = container.firstElementChild;
    expect(banner?.className).toContain('bg-orange-50');
  });

  it('uses red styling for <= 3 days remaining', () => {
    const { container } = render(<TrialBanner daysRemaining={2} />);

    const banner = container.firstElementChild;
    expect(banner?.className).toContain('bg-red-50');
  });

  it('uses red styling for exactly 3 days remaining', () => {
    const { container } = render(<TrialBanner daysRemaining={3} />);

    const banner = container.firstElementChild;
    expect(banner?.className).toContain('bg-red-50');
  });

  it('uses orange styling for exactly 7 days remaining', () => {
    const { container } = render(<TrialBanner daysRemaining={7} />);

    const banner = container.firstElementChild;
    expect(banner?.className).toContain('bg-orange-50');
  });
});
