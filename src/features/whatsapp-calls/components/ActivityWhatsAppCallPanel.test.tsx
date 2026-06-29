import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../actions/calls', () => ({ startWhatsAppCall: vi.fn(), endWhatsAppCall: vi.fn() }));
vi.mock('../actions/persist-call', () => ({ persistWhatsAppCall: vi.fn() }));
vi.mock('../actions/apply-call-disposition', () => ({ applyCallDisposition: vi.fn() }));
vi.mock('../voice-call-media', () => ({
  acquireMic: vi.fn(),
  releaseMic: vi.fn(),
  openCall: vi.fn(),
  subscribeCallEvents: vi.fn(() => () => {}),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { ResolvedPhone } from '@/features/activities/utils/resolve-whatsapp-phone';

import { RECORDING_CONSENT_NOTICE } from '../constants';
import { ActivityWhatsAppCallPanel } from './ActivityWhatsAppCallPanel';

const phone: ResolvedPhone = {
  formatted: '(11) 99999-0000',
  raw: '5511999990000',
  label: '(11) 99999-0000 (Celular)',
  source: 'socio_celular',
};

describe('ActivityWhatsAppCallPanel', () => {
  it('renders the idle state with the recording notice and dial button', () => {
    render(
      <ActivityWhatsAppCallPanel
        enrollmentId="e1"
        stepId="s1"
        cadenceId="c1"
        leadId="l1"
        leadName="Empresa X"
        phones={[phone]}
        activityName="Ligação 1"
        callScript={null}
        onResolved={vi.fn()}
      />,
    );

    expect(screen.getByText('Ligação 1')).toBeInTheDocument();
    expect(screen.getByText('Empresa X')).toBeInTheDocument();
    expect(screen.getByText(RECORDING_CONSENT_NOTICE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ligar via WhatsApp/ })).toBeInTheDocument();
  });
});
