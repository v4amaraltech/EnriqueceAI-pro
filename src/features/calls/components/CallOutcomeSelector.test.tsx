import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DISPOSITION_OPTIONS } from '../disposition';
import { CallOutcomeSelector } from './CallOutcomeSelector';

describe('CallOutcomeSelector', () => {
  it('renderiza as 5 opções de desfecho', () => {
    render(<CallOutcomeSelector value="significant" onChange={vi.fn()} />);
    for (const option of DISPOSITION_OPTIONS) {
      expect(screen.getByText(option.label)).toBeInTheDocument();
    }
  });

  it('mostra a consequência (hint) de cada desfecho — o SDR precisa ver antes de escolher', () => {
    render(<CallOutcomeSelector value="significant" onChange={vi.fn()} />);
    // "Avança a cadência" aparece em 2 opções; "Reagenda" em 2; "Volta para a fila" em 1.
    expect(screen.getAllByText('Avança a cadência')).toHaveLength(2);
    expect(screen.getAllByText('Reagenda (ligar de novo)')).toHaveLength(2);
    expect(screen.getByText('Volta para a fila')).toBeInTheDocument();
  });

  it('marca como selecionado o desfecho recebido em `value`', () => {
    render(<CallOutcomeSelector value="no_contact" onChange={vi.fn()} />);
    const selected = screen.getByRole('radio', { checked: true });
    expect(selected).toHaveAttribute('value', 'no_contact');
  });

  it('expõe os desfechos como radios num grupo rotulado (acessibilidade)', () => {
    render(<CallOutcomeSelector value="significant" onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Desfecho da ligação' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(DISPOSITION_OPTIONS.length);
  });

  it('desabilita todos os radios quando disabled', () => {
    render(<CallOutcomeSelector value="significant" onChange={vi.fn()} disabled />);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
  });
});
