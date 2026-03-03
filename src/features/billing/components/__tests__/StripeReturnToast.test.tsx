import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';

import { StripeReturnToast } from '../StripeReturnToast';

const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
  },
}));

describe('StripeReturnToast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it('shows success toast and cleans URL on ?success=true', () => {
    mockSearchParams = new URLSearchParams('success=true');

    render(<StripeReturnToast />);

    expect(toast.success).toHaveBeenCalledWith('Assinatura atualizada com sucesso!');
    expect(mockReplace).toHaveBeenCalledWith('/settings/billing');
  });

  it('shows info toast and cleans URL on ?canceled=true', () => {
    mockSearchParams = new URLSearchParams('canceled=true');

    render(<StripeReturnToast />);

    expect(toast.info).toHaveBeenCalledWith('Checkout cancelado. Nenhuma alteração foi feita.');
    expect(mockReplace).toHaveBeenCalledWith('/settings/billing');
  });

  it('does nothing when no query params', () => {
    mockSearchParams = new URLSearchParams();

    render(<StripeReturnToast />);

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
