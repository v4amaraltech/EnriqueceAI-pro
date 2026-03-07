import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { InvoiceItem } from '../../actions/fetch-invoices';
import { InvoiceHistory } from '../InvoiceHistory';

function makeInvoice(overrides: Partial<InvoiceItem> = {}): InvoiceItem {
  return {
    id: 'inv_123',
    date: '2026-03-01T00:00:00.000Z',
    amountCents: 34900,
    status: 'paid',
    pdfUrl: 'https://stripe.com/invoice.pdf',
    ...overrides,
  };
}

describe('InvoiceHistory', () => {
  it('renders empty state when no invoices', () => {
    render(<InvoiceHistory invoices={[]} />);

    expect(screen.getByText(/nenhuma fatura ainda/i)).toBeInTheDocument();
  });

  it('renders invoice list with date and amount', () => {
    const invoices = [
      makeInvoice({ id: 'inv_1', amountCents: 34900, status: 'paid' }),
      makeInvoice({ id: 'inv_2', amountCents: 14900, status: 'open', date: '2026-02-01T00:00:00.000Z' }),
    ];
    render(<InvoiceHistory invoices={invoices} />);

    expect(screen.getByText('Pago')).toBeInTheDocument();
    expect(screen.getByText('Pendente')).toBeInTheDocument();
  });

  it('renders PDF link when available', () => {
    render(<InvoiceHistory invoices={[makeInvoice()]} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://stripe.com/invoice.pdf');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders failed status badge', () => {
    render(<InvoiceHistory invoices={[makeInvoice({ status: 'uncollectible' })]} />);

    expect(screen.getByText('Falhou')).toBeInTheDocument();
  });
});
