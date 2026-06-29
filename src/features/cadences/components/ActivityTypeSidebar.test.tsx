import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// Mock dnd-kit
vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    isDragging: false,
  }),
}));

import { ActivityTypeSidebar } from './ActivityTypeSidebar';

describe('ActivityTypeSidebar', () => {
  it('should render sidebar with title', () => {
    render(<ActivityTypeSidebar />);
    expect(screen.getByText('Atividades')).toBeInTheDocument();
  });

  it('should render all category labels', () => {
    render(<ActivityTypeSidebar />);
    // Categories expanded by default: category label + draggable item for some
    expect(screen.getAllByText('E-mail').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Ligação').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Social Point')).toBeInTheDocument();
    expect(screen.getAllByText('Pesquisa').length).toBeGreaterThanOrEqual(1);
  });

  it('should render activity items when categories are expanded', () => {
    render(<ActivityTypeSidebar />);
    // All categories start expanded
    expect(screen.getByText('LinkedIn')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
  });

  it('should collapse a category when clicked', async () => {
    const user = userEvent.setup();
    render(<ActivityTypeSidebar />);

    // E-mail items visible
    const emailItems = screen.getAllByText('E-mail');
    expect(emailItems.length).toBeGreaterThan(1); // category + item

    // Click the category to collapse
    await user.click(emailItems[0]!);

    // Category label remains, but no draggable item
    // The category button text "E-mail" should still be there, but the inner item "E-mail" hidden
    const after = screen.getAllByText('E-mail');
    expect(after.length).toBe(1); // only the category button
  });

  it('should have data-testid on sidebar', () => {
    render(<ActivityTypeSidebar />);
    expect(screen.getByTestId('activity-sidebar')).toBeInTheDocument();
  });

  it('should create a variation when clicking "+" on a single-type category', async () => {
    const user = userEvent.setup();
    render(<ActivityTypeSidebar />);

    // Only the category header + its single default item exist initially.
    expect(screen.getAllByText(/^Ligação/).length).toBe(2);

    await user.click(screen.getByTitle('Adicionar Ligação'));

    // A new "Ligação 2" variation is added.
    expect(screen.getByText('Ligação 2')).toBeInTheDocument();
  });

  it('should create a variation when clicking "+" on a multi-type category (Social Point)', async () => {
    const user = userEvent.setup();
    render(<ActivityTypeSidebar />);

    // Social Point starts with LinkedIn + WhatsApp, no numbered variations.
    expect(screen.queryByText('LinkedIn 2')).not.toBeInTheDocument();

    await user.click(screen.getByTitle('Adicionar Social Point'));

    // Clicking the header "+" must add a variation (was previously a no-op).
    expect(screen.getByText('LinkedIn 2')).toBeInTheDocument();
  });
});
