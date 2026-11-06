import { describe, expect, it } from 'vitest';

import { resumirHistorico } from './lead-contexto';

describe('resumirHistorico', () => {
  it('conta canais e tira eventos internos do histórico', () => {
    const r = resumirHistorico([
      { created_at: '2026-10-01T10:00:00Z', channel: 'phone', type: 'sent', message_content: 'Caiu na caixa postal.', metadata: { evento: 'caixa_postal' } },
      { created_at: '2026-10-02T10:00:00Z', channel: 'phone', type: 'sent', message_content: 'Falou que vende por distribuidor.', metadata: { evento: 'chamada_finalizada', resultado: { proxima_acao: 'ligar_novamente' } } },
      { created_at: '2026-10-02T10:01:00Z', channel: 'phone', type: 'failed', message_content: 'Ligação falhou (linha_muda).', metadata: { evento: 'chamada_falhou', motivo: 'linha_muda' } },
      { created_at: '2026-10-03T10:00:00Z', channel: 'email', type: 'sent', message_content: '<p>Oi <b>João</b></p>', metadata: { subject: 'Canais', aberto_real_em: '2026-10-03T11:00:00Z' } },
      { created_at: '2026-10-03T11:00:00Z', channel: 'email', type: 'opened', message_content: null, metadata: {} },
      { created_at: '2026-10-04T10:00:00Z', channel: 'email', type: 'sent', message_content: 'Segundo', metadata: { subject: 'Preço' } },
      { created_at: '2026-10-04T10:00:10Z', channel: 'email', type: 'opened', message_content: null, metadata: { automatica: true } },
      { created_at: '2026-10-03T12:00:00Z', channel: 'system', type: 'sent', message_content: 'Cadência pausada', metadata: {} },
    ]);
    expect(r.contagem).toEqual({ ligacoes: 3, ligacoes_atendidas: 1, emails_enviados: 2, emails_abertos: 1, respostas: 0, whatsapps_enviados: 0 });
    expect(r.historico).toHaveLength(5);
    expect(r.historico[3]).toMatchObject({ canal: 'email', texto: 'Oi João', assunto: 'Canais' });
    expect(r.historico[1]).toMatchObject({ resultado: 'chamada_finalizada' });
  });

  it('corta textos longos', () => {
    const r = resumirHistorico([{ created_at: 'x', channel: 'email', type: 'sent', message_content: 'a'.repeat(700), metadata: null }]);
    expect(r.historico[0]!.texto!.length).toBe(601);
  });
});
