import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AnalyticsFilters } from '../AnalyticsFilters';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));

// Radix Select uses pointer capture + scrollIntoView which jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const mockMembers = [
  { userId: 'u1', email: 'alice@test.com' },
  { userId: 'u2', email: 'bob@test.com' },
];

const mockCadences = [
  { id: 'c1', name: 'Outbound Q1' },
  { id: 'c2', name: 'Inbound' },
];

/** Radix Select trigger renders the selected value as text but exposes no
 *  computed accessible name in jsdom, so locate it by its visible text. */
function getComboboxByText(text: string): HTMLElement {
  const trigger = screen
    .getAllByRole('combobox')
    .find((el) => el.textContent?.includes(text));
  if (!trigger) throw new Error(`No combobox found containing text "${text}"`);
  return trigger;
}

describe('AnalyticsFilters', () => {
  it('renders SDR select with all members', async () => {
    const user = userEvent.setup();
    render(<AnalyticsFilters basePath="/reports" members={mockMembers} />);

    const sdrSelect = getComboboxByText('Todos os vendedores');

    await user.click(sdrSelect);
    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    // "Todos os vendedores" + 2 members
    expect(options).toHaveLength(3);
    expect(options[1]!.textContent).toBe('alice');
    expect(options[2]!.textContent).toBe('bob');
  });

  it('renders cadence select when cadences provided', async () => {
    const user = userEvent.setup();
    render(
      <AnalyticsFilters basePath="/reports" members={mockMembers} cadences={mockCadences} />,
    );

    const cadenceSelect = getComboboxByText('Todas as cadências');

    await user.click(cadenceSelect);
    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[1]!.textContent).toBe('Outbound Q1');
  });

  it('does not render cadence select when cadences not provided', () => {
    render(<AnalyticsFilters basePath="/reports" members={mockMembers} />);

    expect(
      screen.queryByText('Todas as cadências'),
    ).not.toBeInTheDocument();
  });

  it('updates URL with sdr param on SDR selection', async () => {
    const user = userEvent.setup();
    render(<AnalyticsFilters basePath="/reports" members={mockMembers} />);

    await user.click(getComboboxByText('Todos os vendedores'));
    const listbox = await screen.findByRole('listbox');
    await user.click(within(listbox).getByRole('option', { name: 'alice' }));

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('sdr=u1'));
  });

  it('updates URL with cadence param on cadence selection', async () => {
    const user = userEvent.setup();
    render(
      <AnalyticsFilters basePath="/reports" members={mockMembers} cadences={mockCadences} />,
    );

    await user.click(getComboboxByText('Todas as cadências'));
    const listbox = await screen.findByRole('listbox');
    await user.click(within(listbox).getByRole('option', { name: 'Outbound Q1' }));

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('cadence=c1'));
  });

  it('renders children slot', () => {
    render(
      <AnalyticsFilters basePath="/reports" members={mockMembers}>
        <button>Export PDF</button>
      </AnalyticsFilters>,
    );

    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeInTheDocument();
  });
});
