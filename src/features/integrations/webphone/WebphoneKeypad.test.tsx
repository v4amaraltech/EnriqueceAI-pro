import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ sendDtmf: vi.fn() }));
vi.mock('./webphone-client', () => ({ sendDtmf: client.sendDtmf }));

import { WebphoneKeypad } from './WebphoneKeypad';

describe('WebphoneKeypad', () => {
  beforeEach(() => {
    client.sendDtmf.mockReset();
    client.sendDtmf.mockReturnValue('RFC2833');
  });

  it('tem as 12 teclas com rótulo acessível', () => {
    render(<WebphoneKeypad />);
    for (const name of ['Tecla 0', 'Tecla 1', 'Tecla 9', 'Tecla asterisco', 'Tecla sustenido']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button')).toHaveLength(12);
    expect(screen.getByTestId('webphone-key-star')).toBeInTheDocument();
    expect(screen.getByTestId('webphone-key-hash')).toBeInTheDocument();
  });

  it('clicar em "Tecla 5" chama sendDtmf("5")', () => {
    render(<WebphoneKeypad />);
    fireEvent.click(screen.getByRole('button', { name: 'Tecla 5' }));
    expect(client.sendDtmf).toHaveBeenCalledWith('5');
  });

  it('o eco mostra só os tons enviados (retorno não nulo)', () => {
    render(<WebphoneKeypad />);
    fireEvent.click(screen.getByRole('button', { name: 'Tecla 1' }));
    client.sendDtmf.mockReturnValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Tecla 2' }));
    client.sendDtmf.mockReturnValue('INFO');
    fireEvent.click(screen.getByRole('button', { name: 'Tecla 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tecla sustenido' }));
    expect(screen.getByTestId('webphone-keypad-sent')).toHaveTextContent('Enviado: 1 3 #');
    expect(screen.getByTestId('webphone-keypad-sent')).toHaveAttribute('aria-live', 'polite');
  });

  it('o pointerdown na tecla não sobe (não vira arrasto do painel)', () => {
    const onPointerDown = vi.fn();
    render(
      <div onPointerDown={onPointerDown}>
        <WebphoneKeypad />
      </div>,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Tecla 7' }));
    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it('tecla física sem foco em campo envia o tom', () => {
    render(<WebphoneKeypad />);
    fireEvent.keyDown(document.body, { key: '4' });
    fireEvent.keyDown(document.body, { key: '#' });
    expect(client.sendDtmf).toHaveBeenNthCalledWith(1, '4');
    expect(client.sendDtmf).toHaveBeenNthCalledWith(2, '#');
    expect(screen.getByTestId('webphone-keypad-sent')).toHaveTextContent('Enviado: 4 #');
  });

  it('tecla física com foco em textarea/input NÃO envia', () => {
    render(
      <div>
        <textarea aria-label="nota" />
        <input aria-label="campo" />
        <WebphoneKeypad />
      </div>,
    );
    fireEvent.keyDown(screen.getByLabelText('nota'), { key: '5' });
    fireEvent.keyDown(screen.getByLabelText('campo'), { key: '6' });
    expect(client.sendDtmf).not.toHaveBeenCalled();
  });

  it('Shift+3 (que produz "#") envia; Alt e Meta não enviam', () => {
    render(<WebphoneKeypad />);
    fireEvent.keyDown(document.body, { key: '#', code: 'Digit3', shiftKey: true });
    expect(client.sendDtmf).toHaveBeenCalledWith('#');
    client.sendDtmf.mockClear();
    fireEvent.keyDown(document.body, { key: '1', altKey: true });
    fireEvent.keyDown(document.body, { key: '1', metaKey: true });
    expect(client.sendDtmf).not.toHaveBeenCalled();
  });

  it('letras e atalhos com Ctrl não enviam', () => {
    render(<WebphoneKeypad />);
    fireEvent.keyDown(document.body, { key: 'a' });
    fireEvent.keyDown(document.body, { key: '1', ctrlKey: true });
    expect(client.sendDtmf).not.toHaveBeenCalled();
  });

  it('remove o listener ao desmontar', () => {
    const { unmount } = render(<WebphoneKeypad />);
    unmount();
    fireEvent.keyDown(document.body, { key: '9' });
    expect(client.sendDtmf).not.toHaveBeenCalled();
  });
});
