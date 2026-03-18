import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DeltaValue } from '@/shared/utils/comparison';

import { DeltaIndicator } from './DeltaIndicator';

describe('DeltaIndicator', () => {
  it('renders nothing when delta is null', () => {
    const { container } = render(<DeltaIndicator delta={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders positive delta with up arrow and green color', () => {
    const delta: DeltaValue = {
      percentage: 25,
      absolute: 50,
      previousValue: 200,
      direction: 'up',
    };
    render(<DeltaIndicator delta={delta} />);
    const indicator = screen.getByTestId('delta-indicator');
    expect(indicator).toHaveTextContent('+25%');
    expect(indicator.className).toContain('text-green-600');
  });

  it('renders negative delta with down arrow and red color', () => {
    const delta: DeltaValue = {
      percentage: -15,
      absolute: -30,
      previousValue: 200,
      direction: 'down',
    };
    render(<DeltaIndicator delta={delta} />);
    const indicator = screen.getByTestId('delta-indicator');
    expect(indicator).toHaveTextContent('-15%');
    expect(indicator.className).toContain('text-red-600');
  });

  it('renders neutral delta with dash', () => {
    const delta: DeltaValue = {
      percentage: 0,
      absolute: 0,
      previousValue: 100,
      direction: 'neutral',
    };
    render(<DeltaIndicator delta={delta} />);
    const indicator = screen.getByTestId('delta-indicator');
    expect(indicator).toHaveTextContent('—');
  });

  it('inverts colors when invertDelta is true', () => {
    const delta: DeltaValue = {
      percentage: -10,
      absolute: -20,
      previousValue: 200,
      direction: 'down',
    };
    render(<DeltaIndicator delta={delta} invertDelta />);
    const indicator = screen.getByTestId('delta-indicator');
    // Down + invertDelta = green (positive)
    expect(indicator.className).toContain('text-green-600');
  });

  it('shows "Novo" when previous was 0 and current is up', () => {
    const delta: DeltaValue = {
      percentage: null,
      absolute: 50,
      previousValue: 0,
      direction: 'up',
    };
    render(<DeltaIndicator delta={delta} />);
    const indicator = screen.getByTestId('delta-indicator');
    expect(indicator).toHaveTextContent('Novo');
  });
});
