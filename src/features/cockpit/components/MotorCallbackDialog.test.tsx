import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MotorCallbackDialog } from './MotorCallbackDialog';

const toastMessage = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { message: toastMessage, success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Segunda 16/11/2026 12:00 BRT (15:00Z).
const NOW = new Date('2026-11-16T15:00:00Z');

function setup(over: Partial<React.ComponentProps<typeof MotorCallbackDialog>> = {}) {
  const onOpenChange = vi.fn();
  const scheduleCallback = vi.fn().mockResolvedValue({ ok: true });
  render(
    <MotorCallbackDialog open onOpenChange={onOpenChange} scheduleCallback={scheduleCallback} attemptsToday={1} simulated={false} {...over} />,
  );
  return { onOpenChange, scheduleCallback };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('MotorCallbackDialog', () => {
  it('mostra os atalhos de callbackShortcuts e confirma só depois de escolher um', () => {
    setup();
    expect(screen.getByTestId('motor-callback-dialog')).toBeTruthy();
    expect(screen.getByTestId('motor-callback-shortcut-in-1h').textContent).toBe('Em 1 hora');
    expect(screen.getByTestId('motor-callback-shortcut-today-16h').textContent).toBe('Hoje 16h');
    expect(screen.getByTestId('motor-callback-shortcut-next-business-day-9h').textContent).toBe('Amanhã 9h');
    expect((screen.getByTestId('motor-callback-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('confirmar chama scheduleCallback com a data do atalho e a observação, e fecha', async () => {
    const { scheduleCallback, onOpenChange } = setup({ initialNotes: 'pediu retorno' });
    fireEvent.click(screen.getByTestId('motor-callback-shortcut-today-16h'));
    fireEvent.click(screen.getByTestId('motor-callback-confirm'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(scheduleCallback).toHaveBeenCalledWith({ scheduledAt: new Date('2026-11-16T19:00:00Z'), notes: 'pediu retorno' });
  });

  it('data e hora à mão: horário sem folga bloqueia Confirmar e mostra o erro; com folga, envia em Brasília', async () => {
    const { scheduleCallback } = setup();
    fireEvent.click(screen.getByTestId('motor-callback-date'));
    fireEvent.click(await screen.findByRole('button', { name: /November 16th, 2026/ }));
    fireEvent.change(screen.getByTestId('motor-callback-time'), { target: { value: '12:05' } });
    expect(screen.getByTestId('motor-callback-invalid').textContent).toContain('10 minutos');
    expect((screen.getByTestId('motor-callback-confirm') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('motor-callback-time'), { target: { value: '14:30' } });
    expect(screen.queryByTestId('motor-callback-invalid')).toBeNull();
    fireEvent.click(screen.getByTestId('motor-callback-confirm'));
    await waitFor(() => expect(scheduleCallback).toHaveBeenCalledWith({ scheduledAt: new Date('2026-11-16T17:30:00Z') }));
  });

  it('"Hoje 16h" some quando não há folga', () => {
    vi.setSystemTime(new Date('2026-11-16T18:55:00Z')); // 15:55 BRT
    setup();
    expect(screen.queryByTestId('motor-callback-shortcut-today-16h')).toBeNull();
  });

  it('mostra aviso (não erro) fora da janela e com 3 tentativas no mesmo dia', () => {
    vi.setSystemTime(new Date('2026-11-16T21:30:00Z')); // 18:30 BRT; "Em 1 hora" = 19:30 (dentro); 
    setup({ attemptsToday: 3 });
    fireEvent.click(screen.getByTestId('motor-callback-shortcut-in-1h'));
    const warnings = screen.getAllByTestId('motor-callback-warning').map((w) => w.textContent);
    expect(warnings.some((w) => w?.includes('3 tentativas hoje'))).toBe(true);
    expect(screen.queryByTestId('motor-callback-invalid')).toBeNull();
  });

  it('aviso de fora do horário da discagem', () => {
    vi.setSystemTime(new Date('2026-11-16T22:30:00Z')); // 19:30 BRT; +1h = 20:30 BRT (fora)
    setup();
    fireEvent.click(screen.getByTestId('motor-callback-shortcut-in-1h'));
    expect(screen.getByTestId('motor-callback-warning').textContent).toContain('Fora do horário da discagem');
  });

  it('erro do servidor aparece e o diálogo NÃO fecha', async () => {
    const scheduleCallback = vi.fn().mockResolvedValue({ ok: false, error: 'Falha ao agendar o retorno' });
    const { onOpenChange } = setup({ scheduleCallback });
    fireEvent.click(screen.getByTestId('motor-callback-shortcut-next-business-day-9h'));
    fireEvent.click(screen.getByTestId('motor-callback-confirm'));
    await waitFor(() => expect(screen.getByTestId('motor-callback-error').textContent).toBe('Falha ao agendar o retorno'));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('simulado mostra a linha "Simulado: nada é registrado."', () => {
    setup({ simulated: true });
    expect(screen.getByTestId('motor-callback-simulated').textContent).toBe('Simulado: nada é registrado.');
  });

  it('sem scheduleCallback (fixture): avisa que nada é registrado, sem erro, e fecha', async () => {
    const { onOpenChange } = setup({ scheduleCallback: undefined });
    fireEvent.click(screen.getByTestId('motor-callback-shortcut-in-1h'));
    fireEvent.click(screen.getByTestId('motor-callback-confirm'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastMessage).toHaveBeenCalledWith('Fixture de teste: nada é registrado.');
  });
});
