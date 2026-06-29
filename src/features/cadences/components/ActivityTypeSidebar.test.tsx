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

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('../actions/manage-activity-variations', () => ({
  fetchActivityVariations: vi.fn(async () => ({ success: true, data: [] })),
  createActivityVariation: vi.fn(async ({ channel, label, call_provider }: { channel: string; label: string; call_provider?: string | null }) => ({
    success: true,
    data: { id: '00000000-0000-0000-0000-000000000001', org_id: 'org', channel, label, call_provider: call_provider ?? null, sort_order: 0, created_at: '', updated_at: '' },
  })),
  renameActivityVariation: vi.fn(async () => ({ success: true, data: {} })),
  deleteActivityVariation: vi.fn(async () => ({ success: true, data: { id: 'x' } })),
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
    expect(screen.getByText('WhatsApp Msg')).toBeInTheDocument();
    // WhatsApp Ligação lives under the Ligação category (tracked as a phone step)
    expect(screen.getByText('WhatsApp Ligação')).toBeInTheDocument();
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

  it('should create a variation when clicking "+" on the Ligação category', async () => {
    const user = userEvent.setup();
    render(<ActivityTypeSidebar />);

    // Header "Ligação" + default item "Ligação" (the "WhatsApp Ligação" item
    // doesn't match /^Ligação/), so 2 before adding.
    expect(screen.getAllByText(/^Ligação/).length).toBe(2);

    // Two "Adicionar Ligação" titles exist (category header + per-item "+");
    // the header is first in the DOM.
    const [categoryAddButton] = screen.getAllByTitle('Adicionar Ligação');
    await user.click(categoryAddButton!);

    // A new variation is added; label counts existing phone items (Ligação +
    // WhatsApp Ligação = 2) so the next one is "Ligação 3".
    expect(screen.getByText('Ligação 3')).toBeInTheDocument();
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
