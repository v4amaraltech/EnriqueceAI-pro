import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LiveAmdHint } from './LiveAmdHint';
import type { LiveAmdView } from './live-amd-session';

const view: LiveAmdView = {
  prediction: 'voicemail',
  phrase: 'caixa postal',
  confidence: 0.92,
  latencyMs: 1200,
  transcript: 'caixa postal',
  nextActivity: 'not_connected',
  nextActivityReason: 'Caiu na caixa postal.',
};

describe('LiveAmdHint', () => {
  it('mostra a classe e a próxima atividade sem dizer que o desfecho mudou', () => {
    render(<LiveAmdHint view={view} />);
    const hint = screen.getByTestId('live-amd-suggestion');
    expect(hint.textContent).toContain('Sugestão: Caixa postal.');
    expect(hint.textContent).toContain('Próxima atividade: Não conectou.');
    expect(hint.textContent).toContain('O desfecho não muda sozinho.');
  });

  it('não desenha nada enquanto não há sugestão', () => {
    const { container } = render(<LiveAmdHint view={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
