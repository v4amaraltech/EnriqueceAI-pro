import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../actions/org-settings-crud', () => ({
  saveLeadVisibility: vi.fn().mockResolvedValue({ success: true, data: { saved: true } }),
}));

import { LeadAccessSettings } from './LeadAccessSettings';

describe('LeadAccessSettings', () => {
  it('should render title', () => {
    render(<LeadAccessSettings initialMode="all" />);
    expect(screen.getByText('Acesso aos Leads')).toBeInTheDocument();
  });

  it('should show only the two working options', () => {
    render(<LeadAccessSettings initialMode="all" />);
    expect(screen.getByText('Todos veem todos')).toBeInTheDocument();
    expect(screen.getByText('Apenas seus leads')).toBeInTheDocument();
    expect(screen.queryByText(/Por equipe/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('should not offer the team option when the org is in own mode', () => {
    render(<LeadAccessSettings initialMode="own" />);
    expect(screen.queryByText(/Por equipe/)).not.toBeInTheDocument();
  });

  it('should keep the legacy team option visible (and selected) only when the org is already in team mode', () => {
    render(<LeadAccessSettings initialMode="team" />);
    expect(screen.getByText('Por equipe (indisponível)')).toBeInTheDocument();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(3);
    expect(radios.find((r) => r.value === 'team')?.checked).toBe(true);
  });

  it('should have initial mode selected', () => {
    render(<LeadAccessSettings initialMode="own" />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    const ownRadio = radios.find((r) => r.value === 'own');
    expect(ownRadio?.checked).toBe(true);
  });

  it('should allow changing mode', async () => {
    const user = userEvent.setup();
    render(<LeadAccessSettings initialMode="all" />);
    const ownRadio = screen.getAllByRole('radio').find((r) => (r as HTMLInputElement).value === 'own');
    expect(ownRadio).toBeDefined();
    await user.click(ownRadio as HTMLElement);
    expect((ownRadio as HTMLInputElement).checked).toBe(true);
  });

  it('should show save button', () => {
    render(<LeadAccessSettings initialMode="all" />);
    expect(screen.getByText('Salvar Configuração')).toBeInTheDocument();
  });
});
