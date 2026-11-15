import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
vi.mock('sonner', () => toastMock);

import { notifyEnrollErrors, skippedMessage, summarizeEnrollErrors } from './enroll-errors';

const skip = (id: string, name = 'Standard A') => `Lead ${id}: já está na cadência "${name}"`;

describe('enroll-errors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('separa pulados dos outros erros e guarda o nome da primeira cadência', () => {
    expect(summarizeEnrollErrors([skip('1', 'A'), 'Lead 2: não encontrado', skip('3', 'B')])).toEqual({
      skipped: 2,
      firstCadence: 'A',
      others: ['Lead 2: não encontrado'],
    });
  });

  it('singular e plural', () => {
    expect(skippedMessage(1, 'A')).toBe('1 lead pulado: já está em outra cadência (A)');
    expect(skippedMessage(2, 'A')).toBe('2 leads pulados: já estão em outra cadência (A)');
  });

  it('com inscritos: aviso de pulados e de outros erros separados', () => {
    notifyEnrollErrors(2, [skip('1'), skip('2'), 'Lead 3: não encontrado'], 'x');
    expect(toastMock.toast.warning).toHaveBeenCalledWith('2 leads pulados: já estão em outra cadência (Standard A)');
    expect(toastMock.toast.warning).toHaveBeenCalledWith('1 erro(s)');
  });

  it('0 inscritos e todos pulados: mostra a mensagem de pulado, não o texto cru', () => {
    notifyEnrollErrors(0, [skip('1')], 'x');
    expect(toastMock.toast.error).toHaveBeenCalledWith('1 lead pulado: já está em outra cadência (Standard A)');
  });

  it('0 inscritos e erro que não é de pulado: mantém o erro atual', () => {
    notifyEnrollErrors(0, ['Lead 1: não encontrado'], 'x');
    expect(toastMock.toast.error).toHaveBeenCalledWith('Lead 1: não encontrado');
  });
});
