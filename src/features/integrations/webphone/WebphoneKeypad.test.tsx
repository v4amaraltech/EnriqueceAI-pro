import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ sendDtmf: vi.fn() }));
vi.mock('./webphone-client', () => ({ sendDtmf: client.sendDtmf }));

const sound = vi.hoisted(() => ({ play: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock('./webphone-keypad-sound', () => ({
  playKeypadBeep: sound.play,
  readKeypadSound: sound.read,
  writeKeypadSound: sound.write,
}));

import { WebphoneKeypad } from './WebphoneKeypad';

describe('WebphoneKeypad', () => {
  beforeEach(() => {
    client.sendDtmf.mockReset();
    client.sendDtmf.mockReturnValue('RFC2833');
    sound.play.mockReset();
    sound.write.mockReset();
    sound.read.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tem as 12 teclas com rótulo acessível', () => {
    render(<WebphoneKeypad />);
    for (const name of ['Tecla 0', 'Tecla 1', 'Tecla 9', 'Tecla asterisco', 'Tecla sustenido']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button')).toHaveLength(13); // 12 teclas + interruptor de som
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

  describe('retorno (som e visual)', () => {
    it('bip de sucesso por clique e por tecla física; sendDtmf com os mesmos argumentos', () => {
      render(<WebphoneKeypad />);
      fireEvent.click(screen.getByRole('button', { name: 'Tecla 5' }));
      fireEvent.keyDown(document.body, { key: '#' });
      expect(sound.play).toHaveBeenCalledTimes(2);
      expect(sound.play).toHaveBeenNthCalledWith(1, 'ok');
      expect(client.sendDtmf).toHaveBeenNthCalledWith(1, '5');
      expect(client.sendDtmf).toHaveBeenNthCalledWith(2, '#');
      expect(client.sendDtmf).toHaveBeenCalledTimes(2);
    });

    it('tom de falha quando sendDtmf devolve null', () => {
      client.sendDtmf.mockReturnValue(null);
      render(<WebphoneKeypad />);
      fireEvent.click(screen.getByRole('button', { name: 'Tecla 2' }));
      expect(sound.play).toHaveBeenCalledWith('fail');
      expect(sound.play).toHaveBeenCalledTimes(1);
    });

    it('com o som desligado não toca nada e ainda envia', () => {
      sound.read.mockReturnValue(false);
      render(<WebphoneKeypad />);
      const toggle = screen.getByRole('button', { name: 'Som do teclado' });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(screen.getByRole('button', { name: 'Tecla 1' }));
      expect(sound.play).not.toHaveBeenCalled();
      expect(client.sendDtmf).toHaveBeenCalledWith('1');
    });

    it('o interruptor persiste a escolha e silencia/volta o bip', () => {
      render(<WebphoneKeypad />);
      const toggle = screen.getByRole('button', { name: 'Som do teclado' });
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(toggle);
      expect(sound.write).toHaveBeenLastCalledWith(false);
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(screen.getByRole('button', { name: 'Tecla 3' }));
      expect(sound.play).not.toHaveBeenCalled();
      fireEvent.click(toggle);
      expect(sound.write).toHaveBeenLastCalledWith(true);
      fireEvent.click(screen.getByRole('button', { name: 'Tecla 3' }));
      expect(sound.play).toHaveBeenCalledTimes(1);
    });

    it('a tecla fica pressionada ~150 ms e volta', () => {
      vi.useFakeTimers();
      render(<WebphoneKeypad />);
      const key = screen.getByRole('button', { name: 'Tecla 8' });
      fireEvent.click(key);
      expect(key).toHaveAttribute('data-pressed', 'true');
      act(() => {
        vi.advanceTimersByTime(160);
      });
      expect(key).not.toHaveAttribute('data-pressed');
    });

    it('falha mostra "Não consegui enviar a tecla N" em role=alert e some sozinha', () => {
      vi.useFakeTimers();
      client.sendDtmf.mockReturnValue(null);
      render(<WebphoneKeypad />);
      fireEvent.click(screen.getByRole('button', { name: 'Tecla 9' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Não consegui enviar a tecla 9');
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('sucesso não mostra alerta', () => {
      render(<WebphoneKeypad />);
      fireEvent.click(screen.getByRole('button', { name: 'Tecla 9' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
