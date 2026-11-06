import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CallAiOutcome } from './CallAiOutcome';

describe('CallAiOutcome', () => {
  it('sem resultado da IA → nada', () => {
    const { container } = render(<CallAiOutcome outcome={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('mostra resultado, resumo e retorno; sem selo quando confiante', () => {
    render(
      <CallAiOutcome
        outcome={{
          status: 'done',
          disposition: 'callback_requested',
          summary: 'Pediu para ligar amanhã às 15h.',
          callback_at: '2026-11-06T18:00:00.000Z',
          needs_review: false,
        }}
      />,
    );
    expect(screen.getByText('Pediu para ligar depois')).toBeInTheDocument();
    expect(screen.getByText(/Retorno agendado para 06\/11\/2026,? 15:00/)).toBeInTheDocument();
    expect(screen.queryByText('Revisar')).not.toBeInTheDocument();
  });

  it('dúvida ou falha → selo Revisar', () => {
    render(<CallAiOutcome outcome={{ status: 'failed', needs_review: true }} />);
    expect(screen.getByText('Revisar')).toBeInTheDocument();
    expect(screen.getByText('não foi possível classificar')).toBeInTheDocument();
  });

  it('pendente → analisando', () => {
    render(<CallAiOutcome outcome={{ status: 'pending' }} />);
    expect(screen.getByText(/analisando a gravação/)).toBeInTheDocument();
  });
});
