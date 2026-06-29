import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../actions/apply-call-disposition', () => ({ applyCallDisposition: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CallDispositionForm } from './CallDispositionForm';

describe('CallDispositionForm', () => {
  it('renders the 5 dispositions and a confirm button', () => {
    render(<CallDispositionForm enrollmentId="e1" stepId="s1" />);
    expect(screen.getByText('Conversa relevante')).toBeInTheDocument();
    expect(screen.getByText('Ocupado')).toBeInTheDocument();
    expect(screen.getByText('Não conectou (erro técnico)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmar resultado/ })).toBeInTheDocument();
  });

  it('reveals the callback time picker only for a reschedule disposition', () => {
    render(<CallDispositionForm enrollmentId="e1" stepId="s1" />);
    expect(screen.queryByLabelText('Ligar de novo em:')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Ocupado'));
    expect(screen.getByLabelText('Ligar de novo em:')).toBeInTheDocument();
  });
});
