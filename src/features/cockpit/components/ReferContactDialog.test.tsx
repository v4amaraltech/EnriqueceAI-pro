import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { upsertLeadContact } from '@/features/leads/actions/lead-contacts';

import { ReferContactDialog } from './ReferContactDialog';

// jsdom não tem ResizeObserver (usado pelo Checkbox do diálogo).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock('sonner', () => ({ toast: { message: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/features/leads/actions/lead-contacts', () => ({ upsertLeadContact: vi.fn() }));

const LINE = 'Indicou José Lima (Sócio) – tel 11988887777';
// Sexta 27/11/2026 12h em Brasília: o próximo dia útil é segunda 30/11, 9h.
const NEXT_9H = '2026-11-30T12:00:00.000Z';

const scheduleCallback = vi.fn();
const appendCallNote = vi.fn();
const onOpenChange = vi.fn();

function renderIt(over: Partial<React.ComponentProps<typeof ReferContactDialog>> = {}) {
  const props = { open: true, onOpenChange, leadId: 'lead-1', scheduleCallback, simulated: false, appendCallNote, ...over };
  return { props, ...render(<ReferContactDialog {...props} />) };
}
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = async (id: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(id));
  });
};
function fill() {
  type(/^Nome/, ' José  Lima ');
  type(/^Telefone/, '(11) 98888-7777');
  type(/^Cargo/, 'Sócio');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T15:00:00Z'));
  vi.clearAllMocks();
  vi.mocked(upsertLeadContact).mockResolvedValue({ success: true, data: { id: 'c-1' } } as never);
  appendCallNote.mockImplementation((_id: string, line: string) => `obs do SDR\n${line}`);
  scheduleCallback.mockResolvedValue({ ok: true });
});
afterEach(() => vi.useRealTimers());

describe('ReferContactDialog: validação', () => {
  it('nome é obrigatório; sem telefone nem e-mail não salva; telefone curto e e-mail torto são recusados', async () => {
    renderIt();
    await click('refer-save');
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome');
    type(/^Nome/, 'José');
    await click('refer-save');
    expect(screen.getByRole('alert')).toHaveTextContent('telefone/WhatsApp ou o e-mail');
    type(/^Telefone/, '9888');
    await click('refer-save');
    expect(screen.getByRole('alert')).toHaveTextContent('Telefone inválido');
    type(/^Telefone/, '');
    type(/^E-mail/, 'jose@');
    await click('refer-save');
    expect(screen.getByRole('alert')).toHaveTextContent('E-mail inválido');
    expect(upsertLeadContact).not.toHaveBeenCalled();
  });

  it('só e-mail já basta', async () => {
    renderIt();
    type(/^Nome/, 'José');
    type(/^E-mail/, 'jose@acme.com');
    await click('refer-save');
    expect(upsertLeadContact).toHaveBeenCalledWith(expect.objectContaining({ phones: [], emails: [{ tipo: 'corporativo', email: 'jose@acme.com' }] }));
    expect(screen.getByTestId('refer-saved')).toBeInTheDocument();
  });
});

describe('ReferContactDialog: salvar e próximo passo', () => {
  it('cadastra como NÃO principal (WhatsApp por padrão), anota e só então agenda, nesta ordem', async () => {
    renderIt();
    fill();
    await click('refer-save');
    expect(upsertLeadContact).toHaveBeenCalledWith({
      leadId: 'lead-1',
      first_name: 'José',
      last_name: 'Lima',
      job_title: 'Sócio',
      emails: [],
      phones: [{ tipo: 'whatsapp', numero: '11988887777' }],
      neverPrimary: true,
    });
    expect(appendCallNote).toHaveBeenCalledWith('lead-1', LINE);
    expect(scheduleCallback).not.toHaveBeenCalled();
    expect(screen.getByText('Isso cancela qualquer retorno já agendado para este lead.')).toBeInTheDocument();
    expect(screen.getByText(/a discagem liga para José Lima; sem telefone, liga para o contato principal/)).toBeInTheDocument();

    await click('refer-continue');
    expect(scheduleCallback).toHaveBeenCalledWith({
      scheduledAt: new Date(NEXT_9H),
      notes: 'Retorno com José Lima (Sócio) – tel 11988887777',
      contactId: 'c-1',
      callNotes: `obs do SDR\n${LINE}`,
      disposition: 'referred_contact',
    });
    const order = (fn: ReturnType<typeof vi.fn>) => fn.mock.invocationCallOrder[0] as number;
    expect(order(vi.mocked(upsertLeadContact) as never)).toBeLessThan(order(appendCallNote));
    expect(order(appendCallNote)).toBeLessThan(order(scheduleCallback));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('sem marcar "é WhatsApp" o telefone vai como celular', async () => {
    renderIt();
    fill();
    fireEvent.click(screen.getByRole('checkbox'));
    await click('refer-save');
    expect(upsertLeadContact).toHaveBeenCalledWith(expect.objectContaining({ phones: [{ tipo: 'celular', numero: '11988887777' }] }));
  });

  it('são só 2 saídas; "seguir a fila" usa o padrão 9h do próximo dia útil e mostra o horário', async () => {
    renderIt();
    fill();
    await click('refer-save');
    expect(screen.getByTestId('refer-continue')).toHaveTextContent('Agendar retorno e seguir a fila');
    expect(screen.queryByTestId('refer-schedule')).toBeNull();
    expect(screen.getByTestId('refer-saved')).toHaveTextContent('José Lima salvo. Quando retornar?');
    expect(screen.getByTestId('refer-when').textContent).toMatch(/segunda-feira, 30 de novembro.*09:00/);
    await click('refer-continue');
    expect(scheduleCallback).toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: new Date(NEXT_9H), disposition: 'referred_contact' }));
  });

  it('só "abrir o lead" pede a pausa da fila; nome comprido sai do texto do botão', async () => {
    renderIt();
    fill();
    type(/^Nome/, 'Wenceslauzinho Lima');
    await click('refer-save');
    expect(screen.getByTestId('refer-call-now').textContent).toBe('Agendar retorno e abrir o lead');
    await click('refer-continue');
    expect(scheduleCallback.mock.calls[0]?.[0]).not.toHaveProperty('pauseQueueFor');
  });

  it('o horário é editável', async () => {
    renderIt();
    fill();
    await click('refer-save');
    await click('refer-shortcut-in-1h');
    await click('refer-continue');
    expect(scheduleCallback).toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: new Date('2026-11-27T16:00:00.000Z') }));
  });

  it('"Ligar agora" abre o lead em nova aba e conclui igual a "seguir a fila"', async () => {
    renderIt();
    fill();
    await click('refer-save');
    const link = screen.getByTestId('refer-call-now');
    expect(link).toHaveAttribute('href', '/leads/lead-1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('Agendar retorno e abrir o lead de José');
    await click('refer-call-now');
    expect(scheduleCallback).toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: new Date(NEXT_9H), disposition: 'referred_contact', pauseQueueFor: 'José' }));
  });
});

describe('ReferContactDialog: falhas e duplo clique', () => {
  it('falha ao salvar o contato: mostra o erro, não anota e não agenda', async () => {
    vi.mocked(upsertLeadContact).mockResolvedValue({ success: false, error: 'Erro ao criar contato.' });
    renderIt();
    fill();
    await click('refer-save');
    expect(screen.getByRole('alert')).toHaveTextContent('Erro ao criar contato.');
    expect(appendCallNote).not.toHaveBeenCalled();
    expect(scheduleCallback).not.toHaveBeenCalled();
  });

  it('desfecho falhou: erro claro; reabrir e tentar de novo NÃO cadastra o indicado outra vez e mantém o horário', async () => {
    scheduleCallback.mockResolvedValueOnce({ ok: false, error: 'falhou', retornoSaved: true });
    const { props, rerender } = renderIt();
    fill();
    await click('refer-save');
    await click('refer-shortcut-in-1h');
    await click('refer-continue');
    expect(screen.getByRole('alert')).toHaveTextContent('Salvei José, mas não consegui registrar o desfecho. Tentar de novo.');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('refer-shortcut-next-business-day-9h')).toBeDisabled();

    rerender(<ReferContactDialog {...props} open={false} />);
    rerender(<ReferContactDialog {...props} open />);
    expect(screen.getByTestId('refer-saved')).toBeInTheDocument();
    await click('refer-continue');
    expect(upsertLeadContact).toHaveBeenCalledTimes(1);
    expect(scheduleCallback).toHaveBeenCalledTimes(2);
    expect(scheduleCallback.mock.calls[1]?.[0].scheduledAt).toEqual(new Date('2026-11-27T16:00:00.000Z'));
    // O contato já cadastrado é reaproveitado no reenvio.
    expect(scheduleCallback.mock.calls[1]?.[0]).toMatchObject({ contactId: 'c-1' });
  });

  it('duplo clique em salvar e nas saídas grava uma vez só; enquanto grava os botões ficam desabilitados', async () => {
    let finishSave: (v: unknown) => void = () => undefined;
    vi.mocked(upsertLeadContact).mockImplementation(() => new Promise((r) => (finishSave = r)) as never);
    renderIt();
    fill();
    await click('refer-save');
    expect(screen.getByTestId('refer-save')).toBeDisabled();
    fireEvent.submit(screen.getByTestId('refer-save').closest('form') as HTMLFormElement);
    expect(upsertLeadContact).toHaveBeenCalledTimes(1);
    await act(async () => finishSave({ success: true, data: { id: 'c-1' } }));

    scheduleCallback.mockImplementation(() => new Promise(() => undefined));
    await click('refer-continue');
    await click('refer-continue');
    await click('refer-call-now');
    expect(screen.getByTestId('refer-continue')).toBeDisabled();
    expect(screen.getByTestId('refer-call-now')).toHaveAttribute('aria-disabled', 'true');
    expect(scheduleCallback).toHaveBeenCalledTimes(1);
  });

  it('simulado: não cadastra contato nem anota; só passa pelo motor', async () => {
    renderIt({ simulated: true });
    fill();
    await click('refer-save');
    await click('refer-continue');
    expect(upsertLeadContact).not.toHaveBeenCalled();
    expect(appendCallNote).not.toHaveBeenCalled();
    expect(scheduleCallback).toHaveBeenCalledTimes(1);
    expect(scheduleCallback.mock.calls[0]?.[0]).not.toHaveProperty('contactId');
  });
});
