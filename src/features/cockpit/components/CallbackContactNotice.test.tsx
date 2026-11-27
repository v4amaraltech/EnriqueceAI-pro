import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CallbackContactNotice } from './CallbackContactNotice';

describe('CallbackContactNotice', () => {
  it('"Retorno com {nome}"; sem telefone avisa que vai para o principal; sem retorno não mostra nada', () => {
    const { rerender, container } = render(
      <CallbackContactNotice contact={{ name: 'José', contactId: 'c-1' }} />,
    );
    expect(screen.getByTestId('callback-contact')).toHaveTextContent('Retorno com José');
    expect(screen.getByTestId('callback-contact')).not.toHaveTextContent('principal');
    rerender(<CallbackContactNotice contact={{ name: 'José', contactId: null }} />);
    expect(screen.getByTestId('callback-contact')).toHaveTextContent(
      'sem telefone cadastrado, ligando para o principal',
    );
    rerender(<CallbackContactNotice contact={{ name: 'José', contactId: null, refused: true }} />);
    expect(screen.getByTestId('callback-contact')).toHaveTextContent(
      'número do indicado recusado, ligando para o principal',
    );
    rerender(<CallbackContactNotice contact={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
