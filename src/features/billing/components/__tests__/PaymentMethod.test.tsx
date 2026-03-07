import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PaymentMethod } from '../PaymentMethod';

vi.mock('../../actions/create-portal', () => ({
  createPortalSession: vi.fn(),
}));

describe('PaymentMethod', () => {
  it('renders empty state when no payment method', () => {
    render(<PaymentMethod method={null} hasStripeSubscription={false} />);

    expect(screen.getByText(/nenhum método de pagamento/i)).toBeInTheDocument();
  });

  it('renders card details when payment method exists', () => {
    render(
      <PaymentMethod
        method={{ brand: 'visa', last4: '4242', expMonth: 12, expYear: 2027 }}
        hasStripeSubscription={true}
      />,
    );

    expect(screen.getByText(/visa.*4242/i)).toBeInTheDocument();
    expect(screen.getByText(/12\/2027/)).toBeInTheDocument();
  });

  it('shows manage button when has Stripe subscription', () => {
    render(
      <PaymentMethod
        method={{ brand: 'mastercard', last4: '1234', expMonth: 6, expYear: 2028 }}
        hasStripeSubscription={true}
      />,
    );

    expect(screen.getByRole('button', { name: /gerenciar/i })).toBeInTheDocument();
  });

  it('hides manage button when no Stripe subscription', () => {
    render(
      <PaymentMethod
        method={{ brand: 'visa', last4: '4242', expMonth: 12, expYear: 2027 }}
        hasStripeSubscription={false}
      />,
    );

    expect(screen.queryByRole('button', { name: /gerenciar/i })).not.toBeInTheDocument();
  });

  it('shows add payment button in empty state with Stripe subscription', () => {
    render(<PaymentMethod method={null} hasStripeSubscription={true} />);

    expect(screen.getByRole('button', { name: /adicionar pagamento/i })).toBeInTheDocument();
  });
});
