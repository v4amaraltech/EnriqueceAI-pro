import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createPortal } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';

import { Sheet, SheetContent, SheetTitle } from '@/shared/components/ui/sheet';

import { getWebphonePanelHost, registerWebphonePanelHost } from './webphone-panel-host';
import { useWebphonePanelHost, WebphonePanelHost } from './WebphonePanelHost';

describe('registro de encaixes', () => {
  it('o último encaixe registrado vence; ao sair, volta ao anterior e depois a null', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    const offA = registerWebphonePanelHost(a);
    const offB = registerWebphonePanelHost(b);
    expect(getWebphonePanelHost()).toBe(b);
    offB();
    expect(getWebphonePanelHost()).toBe(a);
    offA();
    expect(getWebphonePanelHost()).toBeNull();
  });

  it('remover duas vezes não derruba outro encaixe', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    const offA = registerWebphonePanelHost(a);
    const offB = registerWebphonePanelHost(b);
    offB();
    offB();
    expect(getWebphonePanelHost()).toBe(a);
    offA();
  });
});

function Probe() {
  const host = useWebphonePanelHost();
  return <span data-testid="probe">{host ? 'encaixe' : 'layout'}</span>;
}

describe('WebphonePanelHost', () => {
  it('montado → o painel usa o encaixe; desmontado → volta ao layout', () => {
    const { rerender } = render(
      <>
        <Probe />
        <WebphonePanelHost />
      </>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('encaixe');
    expect(document.querySelector('[data-webphone-panel-host]')).not.toBeNull();

    rerender(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('layout');
  });
});

/** Imita o WebphonePanel: desenha no encaixe quando existe, senão no lugar. */
function FakePanel() {
  const host = useWebphonePanelHost();
  const node = (
    <div data-testid="painel">
      <textarea aria-label="Anotações da ligação" />
    </div>
  );
  return host ? createPortal(node, host) : node;
}

describe('dentro da gaveta do Radix (fila de atividades)', () => {
  it('o painel é desenhado dentro do conteúdo da gaveta e clicar/digitar nele não a fecha', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <>
        <FakePanel />
        <Sheet open onOpenChange={onOpenChange}>
          <SheetContent side="right" showCloseButton={false}>
            <SheetTitle>Executar Atividade</SheetTitle>
            <WebphonePanelHost />
          </SheetContent>
        </Sheet>
      </>,
    );

    const painel = await screen.findByTestId('painel');
    expect(painel.closest('[data-slot="sheet-content"]')).not.toBeNull();

    const notes = screen.getByRole('textbox', { name: 'Anotações da ligação' });
    await user.click(notes);
    await user.type(notes, 'retornar amanhã');
    expect(notes).toHaveValue('retornar amanhã');
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
