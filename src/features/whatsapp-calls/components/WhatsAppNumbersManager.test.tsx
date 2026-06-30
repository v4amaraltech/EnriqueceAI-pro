import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../actions/pairing', () => ({
  createPairingSession: vi.fn(),
  getPairingStatus: vi.fn(),
  cancelPairingSession: vi.fn(),
}));

import type { WhatsAppNumberRow } from '../types';
import { WhatsAppNumbersManager } from './WhatsAppNumbersManager';

const row: WhatsAppNumberRow = {
  userId: 'u1',
  name: 'Maria SDR',
  role: 'sdr',
  session: { id: 'sess', serviceSessionId: 'svc', phoneNumber: '5511999990000', status: 'connected', pairedAt: null },
  usage: { callsLast24h: 3, notConnectedLast24h: 0, notConnectedRate: 0, health: 'healthy', limit: 50 },
};

describe('WhatsAppNumbersManager', () => {
  it('renders a member row with usage and a re-pair action when connected', () => {
    render(<WhatsAppNumbersManager rows={[row]} />);
    expect(screen.getByText('Maria SDR')).toBeInTheDocument();
    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.getByText('3/50')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reparear' })).toBeInTheDocument();
  });

  it('shows the degraded badge when health is degraded', () => {
    render(<WhatsAppNumbersManager rows={[{ ...row, usage: { ...row.usage, health: 'degraded' } }]} />);
    expect(screen.getByText('Degradado')).toBeInTheDocument();
  });
});
