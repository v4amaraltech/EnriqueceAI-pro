import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DialerDaySummary } from './DialerDaySummary';

describe('DialerDaySummary', () => {
  it('mostra ligações, conversas, taxa e quanto falta para o teto', () => {
    render(
      <DialerDaySummary
        callsToday={87}
        answeredToday={19}
        ratePct={21.8}
        dailyCap={400}
        remaining={313}
      />,
    );
    expect(screen.getByText('Conversas')).toBeTruthy();
    expect(screen.getByText('Taxa de conversa')).toBeTruthy();
    expect(screen.getByTestId('dialer-day-calls').textContent).toContain('87');
    expect(screen.getByTestId('dialer-day-answered').textContent).toContain('19');
    expect(screen.getByTestId('dialer-day-rate').textContent).toContain('22%');
    expect(screen.getByTestId('dialer-day-remaining').textContent).toContain('313');
    expect(screen.getByText('Teto de 400 ligações')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Resumo do dia' })).toBeTruthy();
  });

  it('dia vazio e teto estourado não mostram número negativo', () => {
    render(
      <DialerDaySummary
        callsToday={0}
        answeredToday={0}
        ratePct={0}
        dailyCap={400}
        remaining={-5}
      />,
    );
    expect(screen.getByTestId('dialer-day-rate').textContent).toContain('0%');
    expect(screen.getByTestId('dialer-day-remaining').textContent).toContain('0');
    expect(screen.getByTestId('dialer-day-remaining').textContent).not.toContain('-');
  });

  it('nunca usa a palavra motor', () => {
    const { container } = render(
      <DialerDaySummary
        callsToday={1}
        answeredToday={1}
        ratePct={100}
        dailyCap={400}
        remaining={399}
      />,
    );
    expect(container.textContent?.toLowerCase()).not.toContain('motor');
  });
});
