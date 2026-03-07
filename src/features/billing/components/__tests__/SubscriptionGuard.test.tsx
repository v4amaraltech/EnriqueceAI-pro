import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { SubscriptionGuard } from '../SubscriptionGuard';

const mockReplace = vi.fn();
const mockPathname = vi.fn(() => '/leads');

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => mockPathname(),
}));

describe('SubscriptionGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue('/leads');
  });

  it('renders children when subscription is active', () => {
    render(
      <SubscriptionGuard status="active">
        <div>App content</div>
      </SubscriptionGuard>,
    );

    expect(screen.getByText('App content')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('redirects to /upgrade when status is canceled', () => {
    render(
      <SubscriptionGuard status="canceled">
        <div>App content</div>
      </SubscriptionGuard>,
    );

    expect(mockReplace).toHaveBeenCalledWith('/upgrade');
  });

  it('redirects when trialing and period has expired', () => {
    const expired = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    render(
      <SubscriptionGuard status="trialing" periodEnd={expired}>
        <div>App content</div>
      </SubscriptionGuard>,
    );

    expect(mockReplace).toHaveBeenCalledWith('/upgrade');
  });

  it('does not redirect when trialing and period is still active', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    render(
      <SubscriptionGuard status="trialing" periodEnd={future}>
        <div>App content</div>
      </SubscriptionGuard>,
    );

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not redirect when on /upgrade page', () => {
    mockPathname.mockReturnValue('/upgrade');
    render(
      <SubscriptionGuard status="canceled">
        <div>App content</div>
      </SubscriptionGuard>,
    );

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not redirect when on /settings/billing page', () => {
    mockPathname.mockReturnValue('/settings/billing');
    render(
      <SubscriptionGuard status="canceled">
        <div>App content</div>
      </SubscriptionGuard>,
    );

    expect(mockReplace).not.toHaveBeenCalled();
  });
});
