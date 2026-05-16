import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/shared/components/ui/tooltip';

import type { CallRow } from '../types';
import { CallsTable } from './CallsTable';

function createMockCall(overrides?: Partial<CallRow>): CallRow {
  return {
    id: 'call-1',
    org_id: 'org-1',
    user_id: 'user-1',
    lead_id: null,
    origin: '11999991111',
    destination: '11888882222',
    started_at: '2026-02-21T10:00:00Z',
    answered_at: null,
    duration_seconds: 120,
    status: 'significant',
    connected: true,
    hangup_cause: null,
    type: 'outbound',
    cost: null,
    recording_url: null,
    notes: null,
    is_important: false,
    metadata: null,
    transcription: null,
    transcription_status: 'pending',
    transcription_error: null,
    created_at: '2026-02-21T10:00:00Z',
    updated_at: '2026-02-21T10:00:00Z',
    ...overrides,
  };
}

function renderWithProvider(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe('CallsTable', () => {
  it('should render table headers', () => {
    renderWithProvider(<CallsTable calls={[]} onView={vi.fn()} />);

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Origem')).toBeInTheDocument();
    expect(screen.getByText('Destino')).toBeInTheDocument();
    expect(screen.getByText('Data')).toBeInTheDocument();
    expect(screen.getByText('Duração')).toBeInTheDocument();
  });

  it('should render call rows', () => {
    const calls = [createMockCall()];
    renderWithProvider(<CallsTable calls={calls} onView={vi.fn()} />);

    expect(screen.getByText('11999991111')).toBeInTheDocument();
    expect(screen.getByText('11888882222')).toBeInTheDocument();
    expect(screen.getByText('02:00')).toBeInTheDocument();
  });

  it('should format duration correctly', () => {
    const calls = [createMockCall({ duration_seconds: 65 })];
    renderWithProvider(<CallsTable calls={calls} onView={vi.fn()} />);

    expect(screen.getByText('01:05')).toBeInTheDocument();
  });

  it('should call onView when row is clicked', () => {
    const onView = vi.fn();
    const calls = [createMockCall()];
    renderWithProvider(<CallsTable calls={calls} onView={onView} />);

    fireEvent.click(screen.getByText('11999991111'));
    expect(onView).toHaveBeenCalledWith(calls[0]);
  });

  it('should call onView when view button is clicked', () => {
    const onView = vi.fn();
    const calls = [createMockCall()];
    renderWithProvider(<CallsTable calls={calls} onView={onView} />);

    fireEvent.click(screen.getByRole('button', { name: /ver detalhes/i }));
    expect(onView).toHaveBeenCalledWith(calls[0]);
  });

  it('should render multiple calls', () => {
    const calls = [
      createMockCall({ id: 'call-1', origin: '111' }),
      createMockCall({ id: 'call-2', origin: '222' }),
    ];
    renderWithProvider(<CallsTable calls={calls} onView={vi.fn()} />);

    expect(screen.getByText('111')).toBeInTheDocument();
    expect(screen.getByText('222')).toBeInTheDocument();
  });

  it('should render status icon for each call', () => {
    const calls = [createMockCall()];
    const { container } = renderWithProvider(<CallsTable calls={calls} onView={vi.fn()} />);

    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });
});
