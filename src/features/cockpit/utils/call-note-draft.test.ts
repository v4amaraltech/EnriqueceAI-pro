import { afterEach, describe, expect, it } from 'vitest';

import { callNoteKey, readCallNote, writeCallNote } from './call-note-draft';

afterEach(() => sessionStorage.clear());

describe('call note draft', () => {
  it('guarda e relê a nota da mesma tarefa', () => {
    const key = callNoteKey('enr-1', 'step-1');
    writeCallNote(key, 'pediu retorno na quinta');
    expect(readCallNote(key)).toBe('pediu retorno na quinta');
  });

  it('nota vazia remove o rascunho', () => {
    const key = callNoteKey('enr-1', 'step-1');
    writeCallNote(key, 'rascunho');
    writeCallNote(key, '');
    expect(readCallNote(key)).toBe('');
  });

  it('outra tarefa não vê a nota', () => {
    writeCallNote(callNoteKey('enr-1', 'step-1'), 'só desta');
    expect(readCallNote(callNoteKey('enr-2', 'step-1'))).toBe('');
  });
});
