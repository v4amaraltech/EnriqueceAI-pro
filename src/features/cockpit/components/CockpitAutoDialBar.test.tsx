import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { UseCockpitAutoDialResult } from '../hooks/use-cockpit-auto-dial';
import type { CockpitAutoDialState } from '../utils/cockpit-auto-dial-machine';

import { CockpitAutoDialBar } from './CockpitAutoDialBar';

function engine(state: CockpitAutoDialState, extra: Partial<UseCockpitAutoDialResult> = {}): UseCockpitAutoDialResult {
  return {
    state,
    statusText: null,
    card: null,
    tier: null,
    simulated: true,
    callId: null,
    attemptNo: null,
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    confirmOutcome: vi.fn(async () => true),
    ...extra,
  };
}

const status = () => screen.getByTestId('auto-dial-status').textContent;

describe('CockpitAutoDialBar', () => {
  it('desligado: só Iniciar motor, e o clique chama start', () => {
    const e = engine({ phase: 'off' });
    render(<CockpitAutoDialBar engine={e} sessionCalls={0} />);
    expect(status()).toBe('Motor desligado');
    expect(screen.queryByTestId('auto-dial-pause')).toBeNull();
    expect(screen.queryByTestId('auto-dial-stop')).toBeNull();
    fireEvent.click(screen.getByTestId('auto-dial-start'));
    expect(e.start).toHaveBeenCalledTimes(1);
  });

  it('estados principais em português simples', () => {
    const cases: Array<[CockpitAutoDialState, string]> = [
      [{ phase: 'countdown', secondsLeft: 5 }, 'Discando em 5 s'],
      [{ phase: 'in-call' }, 'Em ligação'],
      [{ phase: 'awaiting-sdr', reason: 'answered' }, 'Aguardando o desfecho'],
      [{ phase: 'paused', reason: 'user', message: null }, 'Pausado'],
      [{ phase: 'paused', reason: 'dial_failed', message: 'ramal ocupado' }, 'Pausado: ramal ocupado'],
      [{ phase: 'blocked', reason: 'outside_hours' }, 'Fora do horário (seg-sex 8h-20h)'],
      [{ phase: 'blocked', reason: 'daily_cap' }, 'Teto do dia atingido (400)'],
    ];
    for (const [state, text] of cases) {
      const { unmount } = render(<CockpitAutoDialBar engine={engine(state)} sessionCalls={0} />);
      expect(status()).toBe(text);
      unmount();
    }
  });

  it('próxima tentativa mostra a hora', () => {
    render(<CockpitAutoDialBar engine={engine({ phase: 'waiting', until: Date.UTC(2026, 10, 16, 15, 30) })} sessionCalls={0} />);
    expect(status()).toBe('Próxima tentativa às 12:30');
  });

  it('o estado é anunciado (aria-live)', () => {
    render(<CockpitAutoDialBar engine={engine({ phase: 'in-call' })} sessionCalls={0} />);
    expect(screen.getByTestId('auto-dial-status').getAttribute('aria-live')).toBe('polite');
  });

  it('rodando: Pausar e Parar chamam o hook; pausado mostra Retomar', () => {
    const e = engine({ phase: 'countdown', secondsLeft: 3 });
    const { unmount } = render(<CockpitAutoDialBar engine={e} sessionCalls={0} />);
    fireEvent.click(screen.getByTestId('auto-dial-pause'));
    fireEvent.click(screen.getByTestId('auto-dial-stop'));
    expect(e.pause).toHaveBeenCalledTimes(1);
    expect(e.stop).toHaveBeenCalledTimes(1);
    unmount();

    const p = engine({ phase: 'paused', reason: 'user', message: null });
    render(<CockpitAutoDialBar engine={p} sessionCalls={0} />);
    fireEvent.click(screen.getByTestId('auto-dial-resume'));
    expect(p.resume).toHaveBeenCalledTimes(1);
  });

  it('selo SIMULADO no modo simulado; LIGAÇÃO REAL no modo real', () => {
    const { unmount } = render(<CockpitAutoDialBar engine={engine({ phase: 'off' })} sessionCalls={0} />);
    expect(screen.getByTestId('auto-dial-simulated').textContent).toBe('SIMULADO');
    expect(screen.queryByTestId('auto-dial-live')).toBeNull();
    unmount();
    render(<CockpitAutoDialBar engine={engine({ phase: 'off' }, { simulated: false })} sessionCalls={0} />);
    expect(screen.getByTestId('auto-dial-live').textContent).toBe('LIGAÇÃO REAL');
    expect(screen.queryByTestId('auto-dial-simulated')).toBeNull();
  });

  it('Desligar só aparece em ligação REAL em curso e é separado do Parar', () => {
    const onHangup = vi.fn();
    const { unmount } = render(<CockpitAutoDialBar engine={engine({ phase: 'in-call' })} sessionCalls={1} onHangup={onHangup} />);
    expect(screen.queryByTestId('auto-dial-hangup')).toBeNull(); // simulado
    unmount();
    render(<CockpitAutoDialBar engine={engine({ phase: 'in-call' }, { simulated: false })} sessionCalls={1} onHangup={onHangup} />);
    fireEvent.click(screen.getByTestId('auto-dial-stop'));
    expect(onHangup).not.toHaveBeenCalled(); // Parar não desliga
    fireEvent.click(screen.getByTestId('auto-dial-hangup'));
    expect(onHangup).toHaveBeenCalledTimes(1);
  });

  it('mostra o contador de ligações do motor', () => {
    render(<CockpitAutoDialBar engine={engine({ phase: 'off' })} sessionCalls={7} />);
    expect(screen.getByTestId('auto-dial-counter').textContent).toContain('7');
  });
});
