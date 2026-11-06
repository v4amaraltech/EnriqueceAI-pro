import { describe, expect, it } from 'vitest';

import { assuntoDeResposta, desfechoDoEnvio, parseEmailStepRequest, textoParaHtml } from './email-step';

const EXEC = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e';
const base = { remetente_email: 'Ana@Exemplo.com', assunto: 'Oi', corpo: 'Texto' };

describe('parseEmailStepRequest', () => {
  it('aceita passo reservado', () => {
    const r = parseEmailStepRequest({ ...base, execution_id: EXEC });
    expect(r.ok && r.value).toMatchObject({ executionId: EXEC, testePara: null, remetenteEmail: 'ana@exemplo.com' });
  });
  it('exige execution_id fora do modo teste', () => {
    expect(parseEmailStepRequest(base).ok).toBe(false);
    expect(parseEmailStepRequest({ ...base, execution_id: 'x' }).ok).toBe(false);
  });
  it('modo teste dispensa execution_id e recusa os dois juntos', () => {
    const r = parseEmailStepRequest({ ...base, teste_para: 'eu@x.com' });
    expect(r.ok && r.value.testePara).toBe('eu@x.com');
    expect(parseEmailStepRequest({ ...base, teste_para: 'eu@x.com', execution_id: EXEC }).ok).toBe(false);
  });
  it('recusa remetente, assunto ou corpo ausentes e textos longos', () => {
    expect(parseEmailStepRequest({ ...base, remetente_email: 'nada', execution_id: EXEC }).ok).toBe(false);
    expect(parseEmailStepRequest({ ...base, assunto: ' ', execution_id: EXEC }).ok).toBe(false);
    expect(parseEmailStepRequest({ ...base, corpo: '', execution_id: EXEC }).ok).toBe(false);
    expect(parseEmailStepRequest({ ...base, assunto: 'a'.repeat(151), execution_id: EXEC }).ok).toBe(false);
    expect(parseEmailStepRequest({ ...base, corpo: 'a'.repeat(4001), execution_id: EXEC }).ok).toBe(false);
  });
});

describe('textoParaHtml', () => {
  it('vira parágrafos, preserva quebras e escapa HTML', () => {
    expect(textoParaHtml('Olá, João\n\nLinha 1\nLinha 2\n\n<b>x</b> & y')).toBe(
      '<p>Olá, João</p>\n<p>Linha 1<br>Linha 2</p>\n<p>&lt;b&gt;x&lt;/b&gt; &amp; y</p>',
    );
  });
});

describe('assuntoDeResposta', () => {
  it('prefixa Re: uma vez só', () => {
    expect(assuntoDeResposta('Canais da Camil')).toBe('Re: Canais da Camil');
    expect(assuntoDeResposta('RE: Canais')).toBe('RE: Canais');
  });
});

describe('desfechoDoEnvio', () => {
  it('classifica por estágio e código', () => {
    expect(desfechoDoEnvio({ success: true })).toBe('enviado');
    expect(desfechoDoEnvio({ success: false })).toBe('caixa_indisponivel');
    expect(desfechoDoEnvio({ success: false, stage: 'response', httpStatus: 401 })).toBe('caixa_indisponivel');
    expect(desfechoDoEnvio({ success: false, stage: 'response', httpStatus: 429 })).toBe('caixa_indisponivel');
    expect(desfechoDoEnvio({ success: false, stage: 'response', httpStatus: 400 })).toBe('falhou_avanca');
    expect(desfechoDoEnvio({ success: false, stage: 'response', httpStatus: 503 })).toBe('incerto');
    expect(desfechoDoEnvio({ success: false, stage: 'network' })).toBe('incerto');
  });
});
