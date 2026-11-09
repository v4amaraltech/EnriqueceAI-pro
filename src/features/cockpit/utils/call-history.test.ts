import { describe, expect, it } from 'vitest';

import { toCallHistory, usefulCallScript } from './call-history';

describe('call history', () => {
  it('ordena do mais antigo ao mais recente e resume o texto', () => {
    const entries = toCallHistory([
      { id: 'b', type: 'replied', channel: 'email', message_content: 'pode falar amanhã', created_at: '2026-11-08T12:00:00Z' },
      { id: 'a', type: 'sent', channel: 'whatsapp', message_content: 'olá', created_at: '2026-11-07T12:00:00Z' },
    ]);
    expect(entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(entries[1]?.title).toBe('Respondeu · e-mail');
    expect(entries[0]?.detail).toBe('olá');
  });

  it('ignora o placeholder de script e mantém roteiro real', () => {
    expect(usefulCallScript('Em breve Script de Ligação')).toBeNull();
    expect(usefulCallScript('  ')).toBeNull();
    expect(usefulCallScript('Perguntar pelo sócio e pelo faturamento.')).toBe('Perguntar pelo sócio e pelo faturamento.');
  });
});
