import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoDialOutcomeConfirm } from './AutoDialOutcomeConfirm';

vi.mock('sonner', () => ({ toast: { message: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('./CallOutcomePanel', () => ({ CallOutcomePanel: () => null }));

function setup() {
  const onConfirm = vi.fn().mockResolvedValue(true);
  const scheduleCallback = vi.fn().mockResolvedValue({ ok: true });
  render(<AutoDialOutcomeConfirm callId={null} leadId="lead-1" simulated onConfirm={onConfirm} scheduleCallback={scheduleCallback} attemptsToday={1} />);
  return { onConfirm, scheduleCallback };
}

async function pick(label: string) {
  fireEvent.click(screen.getByTestId('auto-dial-disposition'));
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn(); // jsdom não tem; o Select do Radix chama
});

describe('AutoDialOutcomeConfirm: Pediu para ligar depois', () => {
  it('escolher o desfecho abre o diálogo Ligar depois em vez de confirmar, preservando a observação', async () => {
    const { onConfirm, scheduleCallback } = setup();
    fireEvent.change(screen.getByLabelText('Observação do desfecho'), { target: { value: 'volta às 15h' } });
    await pick('Pediu para ligar depois');
    fireEvent.click(screen.getByTestId('auto-dial-confirm-button'));
    expect(onConfirm).not.toHaveBeenCalled();
    const dialog = await screen.findByTestId('motor-callback-dialog');
    expect((within(dialog).getByLabelText('Observação (opcional)') as HTMLTextAreaElement).value).toBe('volta às 15h');
    fireEvent.click(within(dialog).getByTestId('motor-callback-shortcut-in-1h'));
    fireEvent.click(within(dialog).getByTestId('motor-callback-confirm'));
    await waitFor(() => expect(scheduleCallback).toHaveBeenCalledTimes(1));
    expect(scheduleCallback.mock.calls[0]![0]).toMatchObject({ notes: 'volta às 15h' });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('outros desfechos confirmam direto, sem diálogo', async () => {
    const { onConfirm, scheduleCallback } = setup();
    await pick('Não atendeu');
    fireEvent.click(screen.getByTestId('auto-dial-confirm-button'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('motor-callback-dialog')).toBeNull();
    expect(scheduleCallback).not.toHaveBeenCalled();
  });
});
