import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeedbackForm } from './FeedbackForm';

// A página real é server-rendered e exige um closer_feedback_request no banco,
// então o formulário não é alcançável por E2E sem semear dados. Estes testes
// exercitam o componente direto — e rodam no CI, que não roda Playwright.

const TOKEN = '00000000-0000-0000-0000-000000000000';

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Corpo JSON da última chamada ao /api/feedback. */
function lastPayload(fetchMock: ReturnType<typeof mockFetchOk>) {
  const [, init] = fetchMock.mock.calls.at(-1) ?? [];
  return JSON.parse((init as RequestInit).body as string);
}

describe('FeedbackForm — Oportunidade Qualificada (SAO)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('esconde a pergunta até o resultado ser "Realizada"', async () => {
    render(<FeedbackForm token={TOKEN} />);

    expect(screen.queryByText(/Oportunidade Qualificada \(SAO\)/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Realizada' }));
    expect(screen.getByText(/Oportunidade Qualificada \(SAO\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Qualificada' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Não qualificada' })).toBeInTheDocument();
  });

  it('não some em No-show / Remarcada porque nunca aparece', async () => {
    render(<FeedbackForm token={TOKEN} />);

    await userEvent.click(screen.getByRole('button', { name: 'No-show' }));
    expect(screen.queryByText(/Oportunidade Qualificada \(SAO\)/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remarcada' }));
    expect(screen.queryByText(/Oportunidade Qualificada \(SAO\)/)).not.toBeInTheDocument();
  });

  it('mantém o envio bloqueado enquanto a SAO não for respondida', async () => {
    render(<FeedbackForm token={TOKEN} />);

    await userEvent.click(screen.getByRole('button', { name: 'Realizada' }));
    await userEvent.click(screen.getByRole('button', { name: 'Bateu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }));
    await userEvent.type(screen.getByRole('textbox'), 'call tranquila');

    // Tudo preenchido MENOS a SAO — ainda travado.
    const submit = screen.getByRole('button', { name: /Enviar feedback/ });
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Qualificada' }));
    expect(submit).toBeEnabled();
  });

  it('envia oportunidade_qualificada=true quando "Qualificada"', async () => {
    const fetchMock = mockFetchOk();
    render(<FeedbackForm token={TOKEN} />);

    await userEvent.click(screen.getByRole('button', { name: 'Realizada' }));
    await userEvent.click(screen.getByRole('button', { name: 'Bateu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }));
    await userEvent.click(screen.getByRole('button', { name: 'Qualificada' }));
    await userEvent.type(screen.getByRole('textbox'), 'call tranquila');
    await userEvent.click(screen.getByRole('button', { name: /Enviar feedback/ }));

    expect(lastPayload(fetchMock).oportunidade_qualificada).toBe(true);
  });

  it('envia oportunidade_qualificada=false quando "Não qualificada"', async () => {
    const fetchMock = mockFetchOk();
    render(<FeedbackForm token={TOKEN} />);

    await userEvent.click(screen.getByRole('button', { name: 'Realizada' }));
    await userEvent.click(screen.getByRole('button', { name: 'Bateu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }));
    await userEvent.click(screen.getByRole('button', { name: 'Não qualificada' }));
    await userEvent.type(screen.getByRole('textbox'), 'lead fora do perfil');
    await userEvent.click(screen.getByRole('button', { name: /Enviar feedback/ }));

    expect(lastPayload(fetchMock).oportunidade_qualificada).toBe(false);
  });

  it('envia SAO nula em No-show — o campo não se aplica', async () => {
    const fetchMock = mockFetchOk();
    render(<FeedbackForm token={TOKEN} />);

    await userEvent.click(screen.getByRole('button', { name: 'No-show' }));
    await userEvent.click(screen.getByRole('button', { name: /Enviar feedback/ }));

    expect(lastPayload(fetchMock).oportunidade_qualificada).toBeNull();
  });

  it('não manda SAO no payload quando o resultado final é No-show', async () => {
    const fetchMock = mockFetchOk();
    render(<FeedbackForm token={TOKEN} />);

    // Responde como Realizada...
    await userEvent.click(screen.getByRole('button', { name: 'Realizada' }));
    await userEvent.click(screen.getByRole('button', { name: 'Qualificada' }));
    // ...e volta atrás.
    await userEvent.click(screen.getByRole('button', { name: 'No-show' }));
    await userEvent.click(screen.getByRole('button', { name: /Enviar feedback/ }));

    expect(lastPayload(fetchMock).oportunidade_qualificada).toBeNull();
  });

  // O teste acima NÃO prova que handleResultChange limpa o estado: o payload já
  // manda null por construção (`isMeetingDone ? oportunidadeQualificada : null`),
  // então ele passaria mesmo sem a limpeza. Quem cobre a limpeza é o teste
  // abaixo — o caso que dói de verdade é o closer VOLTAR para "Realizada".
  it('exige responder a SAO de novo ao voltar para "Realizada"', async () => {
    render(<FeedbackForm token={TOKEN} />);

    // Responde tudo como Realizada — envio liberado.
    await userEvent.click(screen.getByRole('button', { name: 'Realizada' }));
    await userEvent.click(screen.getByRole('button', { name: 'Bateu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }));
    await userEvent.click(screen.getByRole('button', { name: 'Qualificada' }));
    await userEvent.type(screen.getByRole('textbox'), 'call tranquila');
    expect(screen.getByRole('button', { name: /Enviar feedback/ })).toBeEnabled();

    // Troca para No-show e volta atrás, repondo TUDO menos a SAO.
    await userEvent.click(screen.getByRole('button', { name: 'No-show' }));
    await userEvent.click(screen.getByRole('button', { name: 'Realizada' }));
    await userEvent.click(screen.getByRole('button', { name: 'Bateu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }));

    // Se a SAO não tivesse sido zerada, a resposta anterior continuaria
    // marcada e o closer enviaria um SAO que não revisou.
    expect(screen.getByRole('button', { name: /Enviar feedback/ })).toBeDisabled();
  });
});
