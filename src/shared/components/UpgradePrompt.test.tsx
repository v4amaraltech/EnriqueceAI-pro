import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UpgradePrompt } from './UpgradePrompt';

describe('UpgradePrompt', () => {
  it('should render feature name and default description', () => {
    render(<UpgradePrompt featureName="Integrações CRM" requiredPlan="Pro" />);
    expect(screen.getByText('Integrações CRM')).toBeDefined();
    expect(screen.getByText(/Disponível a partir do plano Pro/)).toBeDefined();
  });

  it('should render custom description when provided', () => {
    render(
      <UpgradePrompt
        featureName="Calendar"
        requiredPlan="Pro"
        description="Sincronize seus compromissos"
      />,
    );
    expect(screen.getByText('Sincronize seus compromissos')).toBeDefined();
  });

  it('should link to billing settings', () => {
    render(<UpgradePrompt featureName="CRM" requiredPlan="Pro" />);
    const link = screen.getByRole('link', { name: 'Fazer upgrade' });
    expect(link.getAttribute('href')).toBe('/settings/billing');
  });

  it('should not render default description when custom is provided', () => {
    render(
      <UpgradePrompt
        featureName="CRM"
        requiredPlan="Pro"
        description="Custom description"
      />,
    );
    expect(screen.queryByText(/Disponível a partir do plano/)).toBeNull();
    expect(screen.getByText('Custom description')).toBeDefined();
  });
});
