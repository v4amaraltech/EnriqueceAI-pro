import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getVerbalConsentStateAction, recordVerbalConsentAction } from '../actions/verbal-consent';

import { VerbalConsentButton } from './VerbalConsentButton';

vi.mock('../actions/verbal-consent', () => ({ getVerbalConsentStateAction: vi.fn(), recordVerbalConsentAction: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(3000); });

describe('VerbalConsentButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('flag desligada: nao aparece', async () => {
    vi.mocked(getVerbalConsentStateAction).mockResolvedValue({ success: true, data: { state: 'disabled' } });
    render(<VerbalConsentButton callId="c1" />);
    await tick();
    expect(screen.queryByTestId('verbal-consent-button')).toBeNull();
    expect(screen.queryByTestId('verbal-consent-recorded')).toBeNull();
  });

  it('ligacao ainda nao atendida: espera sem mostrar o botao', async () => {
    vi.mocked(getVerbalConsentStateAction).mockResolvedValue({ success: true, data: { state: 'unknown' } });
    render(<VerbalConsentButton callId="c1" />);
    await tick();
    await tick();
    expect(screen.queryByTestId('verbal-consent-button')).toBeNull();
    expect(vi.mocked(getVerbalConsentStateAction).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('atendida: mostra o botao e registra com um clique', async () => {
    vi.mocked(getVerbalConsentStateAction)
      .mockResolvedValueOnce({ success: true, data: { state: 'unknown' } })
      .mockResolvedValue({ success: true, data: { state: 'available' } });
    vi.mocked(recordVerbalConsentAction).mockResolvedValue({ success: true, data: { alreadyRecorded: false } });
    render(<VerbalConsentButton callId="c1" />);
    await tick();
    await tick();
    const button = screen.getByTestId('verbal-consent-button');
    expect(button.textContent).toBe('Aceitou WhatsApp');
    await act(async () => { fireEvent.click(button); });
    expect(recordVerbalConsentAction).toHaveBeenCalledWith({ callId: 'c1' });
    expect(screen.getByTestId('verbal-consent-recorded')).toBeTruthy();
    expect(screen.queryByTestId('verbal-consent-button')).toBeNull();
  });
});
