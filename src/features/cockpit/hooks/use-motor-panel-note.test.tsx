import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyWebphoneCall } from '@/features/calls/actions/classify-webphone-call';
import { resetWebphoneCallContextForTests } from '@/features/integrations/webphone/webphone-call-context';

import { useMotorCallNoteSaver } from './use-motor-call-note-saver';
import { useMotorPanelNote } from './use-motor-panel-note';

vi.mock('@/features/calls/actions/classify-webphone-call', () => ({ classifyWebphoneCall: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

const CALL_A = '11111111-1111-4111-8111-111111111111';
const CALL_B = '22222222-2222-4222-8222-222222222222';

interface Props {
  live?: boolean;
  leadId: string | null;
  leadName?: string;
  engineCallId: string | null;
  dialing?: boolean;
  active?: boolean;
}
function setup(initial: Props) {
  return renderHook(
    (p: Props) => {
      const saver = useMotorCallNoteSaver();
      return useMotorPanelNote({ live: p.live ?? true, leadId: p.leadId, leadName: p.leadName ?? 'Acme', engineCallId: p.engineCallId, dialing: p.dialing ?? false, active: p.active ?? true, saver });
    },
    { initialProps: initial },
  );
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const type = (r: { current: ReturnType<typeof useMotorPanelNote> }, v: string) => act(() => r.current.onChange(v));

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  resetWebphoneCallContextForTests();
  vi.mocked(classifyWebphoneCall).mockResolvedValue({ success: true, data: { callId: CALL_A, notesApplied: true } });
});

describe('anotação do painel grava na ligação do lead', () => {
  it('digitar NÃO grava; sair do campo (blur) grava na ligação certa, só a nota, e mostra "Guardada"', async () => {
    const { result } = setup({ leadId: 'A', engineCallId: CALL_A });
    type(result, '  pediu proposta  ');
    expect(classifyWebphoneCall).not.toHaveBeenCalled(); // nada de Server Action por tecla
    act(() => result.current.onBlur());
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledTimes(1);
    const input = vi.mocked(classifyWebphoneCall).mock.calls[0]![0];
    expect(input).toMatchObject({ callId: CALL_A, notes: 'pediu proposta' });
    expect('sdrOutcome' in input).toBe(false);
    expect(result.current.status).toEqual({ kind: 'saved' });
    act(() => result.current.onBlur());
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledTimes(1); // mesmo texto/callId não regrava
  });

  it('antes de uma ação final: flush grava', async () => {
    const { result } = setup({ leadId: 'A', engineCallId: CALL_A });
    type(result, 'obs');
    act(() => result.current.flush());
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledWith(expect.objectContaining({ callId: CALL_A, notes: 'obs' }));
  });

  it('trocar de lead com texto pendente grava na ligação ANTERIOR e avisa; o campo passa a ser o do lead novo', async () => {
    const { result, rerender } = setup({ leadId: 'A', leadName: 'Acme', engineCallId: CALL_A });
    type(result, 'texto do A');
    rerender({ leadId: 'B', leadName: 'Beta', engineCallId: CALL_A, dialing: true });
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledWith(expect.objectContaining({ callId: CALL_A, notes: 'texto do A' }));
    expect(toast.info).toHaveBeenCalledWith('Anotação guardada na ligação de Acme');
    expect(result.current.value).toBe('');
    // O lead B ainda disca com o callId ANTIGO no estado: não é a ligação dele.
    type(result, 'texto do B');
    act(() => result.current.onBlur());
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledTimes(1);
    expect(result.current.status).toEqual({ kind: 'waiting' });
  });

  it('sem callId (discando) aguarda e grava assim que a ligação do lead existe', async () => {
    const { result, rerender } = setup({ leadId: 'B', engineCallId: CALL_A, dialing: true });
    // CALL_A já foi visto com o lead B? Não: primeiro render com B e callId A => A é atribuída a B. Use lead novo sem callId.
    rerender({ leadId: 'C', engineCallId: null, dialing: true });
    type(result, 'obs');
    act(() => result.current.onBlur());
    await flush();
    expect(classifyWebphoneCall).not.toHaveBeenCalled();
    expect(result.current.status).toEqual({ kind: 'waiting' });
    rerender({ leadId: 'C', engineCallId: CALL_B, dialing: false });
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledWith(expect.objectContaining({ callId: CALL_B, notes: 'obs' }));
    expect(result.current.status).toEqual({ kind: 'saved' });
  });

  it('ligação nunca criada (sem callId e já sem discar): o texto fica e o estado diz que NÃO foi gravado', async () => {
    const { result } = setup({ leadId: 'C', engineCallId: null, dialing: false });
    type(result, 'obs');
    act(() => result.current.onBlur());
    await flush();
    expect(classifyWebphoneCall).not.toHaveBeenCalled();
    expect(result.current.value).toBe('obs');
    expect(result.current.status).toEqual({ kind: 'no-call' });
  });

  it('erro de gravação: mostra o erro, mantém o texto e permite tentar de novo', async () => {
    vi.mocked(classifyWebphoneCall).mockResolvedValueOnce({ success: false, error: 'Falha de rede' });
    const { result } = setup({ leadId: 'A', engineCallId: CALL_A });
    type(result, 'importante');
    act(() => result.current.onBlur());
    await flush();
    expect(result.current.status).toEqual({ kind: 'error', message: 'Falha de rede' });
    expect(result.current.value).toBe('importante');
    act(() => result.current.retry());
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledTimes(2);
    expect(result.current.status).toEqual({ kind: 'saved' });
  });

  it('simulado: nunca grava e diz isso', async () => {
    const { result } = setup({ live: false, leadId: 'A', engineCallId: CALL_A });
    type(result, 'obs');
    act(() => result.current.onBlur());
    await flush();
    expect(classifyWebphoneCall).not.toHaveBeenCalled();
    expect(result.current.status).toEqual({ kind: 'simulated' });
  });

  it('o campo NÃO é esvaziado nem trocado enquanto o SDR digita, mesmo se a ligação muda (mesmo lead)', async () => {
    const { result, rerender } = setup({ leadId: 'A', engineCallId: CALL_A });
    type(result, 'digitando');
    rerender({ leadId: 'A', engineCallId: CALL_B });
    await flush();
    expect(result.current.value).toBe('digitando');
  });

  it('deixar de estar em ligação (parar a discagem) grava o texto pendente', async () => {
    const { result, rerender } = setup({ leadId: 'A', engineCallId: CALL_A, active: true });
    type(result, 'antes de parar');
    rerender({ leadId: 'A', engineCallId: CALL_A, active: false });
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledWith(expect.objectContaining({ callId: CALL_A, notes: 'antes de parar' }));
  });

  it('o rascunho NÃO gravado (simulado) volta quando o lead volta; texto vazio não grava', async () => {
    const { result, rerender } = setup({ live: false, leadId: 'A', engineCallId: CALL_A });
    type(result, 'rascunho');
    rerender({ live: false, leadId: 'B', engineCallId: CALL_B });
    await flush();
    rerender({ live: false, leadId: 'A', engineCallId: CALL_B });
    expect(result.current.value).toBe('rascunho');
    const empty = setup({ leadId: 'Z', engineCallId: CALL_A });
    act(() => empty.result.current.onBlur());
    await flush();
    expect(classifyWebphoneCall).not.toHaveBeenCalled();
  });

  it('lead ligado 2 vezes na mesma aba: a 2ª ligação NÃO recebe a nota da 1ª e o rascunho foi limpo', async () => {
    const { result, rerender } = setup({ leadId: 'A', engineCallId: CALL_A });
    type(result, 'X');
    act(() => result.current.onBlur());
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('cockpit.callNote.v1:motor:A')).toBeNull(); // gravou: rascunho limpo
    rerender({ leadId: 'B', engineCallId: CALL_A, dialing: true });
    await flush();
    rerender({ leadId: 'A', engineCallId: CALL_B }); // o lead A volta, agora com a 2ª ligação
    await flush();
    expect(result.current.value).toBe(''); // não reabre com o texto velho
    expect(classifyWebphoneCall).toHaveBeenCalledTimes(1); // nada foi regravado na 2ª ligação
    // ...mas se o SDR escrever de novo (mesmo texto) na 2ª, grava nela
    type(result, 'X');
    act(() => result.current.onBlur());
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledTimes(2);
    expect(vi.mocked(classifyWebphoneCall).mock.calls[1]![0]).toMatchObject({ callId: CALL_B, notes: 'X' });
  });

  it('mesmo lead com ligação nova SEM sair do painel (redial): o texto já gravado não vai para a ligação nova', async () => {
    const { result, rerender } = setup({ leadId: 'A', engineCallId: CALL_A });
    type(result, 'X');
    act(() => result.current.onBlur());
    await flush();
    rerender({ leadId: 'A', engineCallId: CALL_B });
    await flush();
    expect(classifyWebphoneCall).toHaveBeenCalledTimes(1);
  });

  it('texto com ERRO de gravação permanece no rascunho (e volta quando o lead volta)', async () => {
    vi.mocked(classifyWebphoneCall).mockResolvedValue({ success: false, error: 'Falha de rede' });
    const { result, rerender } = setup({ leadId: 'A', engineCallId: CALL_A });
    type(result, 'importante');
    act(() => result.current.onBlur());
    await flush();
    expect(window.sessionStorage.getItem('cockpit.callNote.v1:motor:A')).toBe('importante');
    rerender({ leadId: 'B', engineCallId: CALL_A, dialing: true });
    await flush();
    rerender({ leadId: 'A', engineCallId: CALL_A });
    expect(result.current.value).toBe('importante');
  });

  it('getValue devolve sempre o texto mais recente (observação do "Ligar depois")', async () => {
    const { result } = setup({ leadId: 'A', engineCallId: CALL_A });
    const getValue = result.current.getValue;
    type(result, 'recente');
    await flush();
    expect(getValue()).toBe('recente');
  });
});
