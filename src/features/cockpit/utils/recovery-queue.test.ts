import { describe, expect, it } from 'vitest';

import { NO_RESUME_REASON_NAMES, RECOVERY_BLOCKED_REASON_NAMES, isNoResumeReason } from './recovery-queue';

describe('motivos de perda "não retomar"', () => {
  it('isNoResumeReason casa os nomes reais de loss_reasons, ignorando caixa e acento', () => {
    for (const name of ['Blocklist', 'SPAM', 'spam', 'Spam', '  Spam  ', 'Adolescente/Criança', 'adolescente/crianca', 'BLOCKLIST', ' Blocklist\t', 'Adolescente/Criança ']) {
      expect(isNoResumeReason(name), name).toBe(true);
    }
    for (const name of ['Sem interesse', 'Cliente', 'Duplicado', '', null, undefined]) {
      expect(isNoResumeReason(name), String(name)).toBe(false);
    }
  });

  it('a lista da recuperação contém a de não retomar (uma só fonte) e mais motivos', () => {
    for (const name of NO_RESUME_REASON_NAMES) expect(RECOVERY_BLOCKED_REASON_NAMES).toContain(name);
    expect(RECOVERY_BLOCKED_REASON_NAMES).toContain('Pessoa Física');
    expect(RECOVERY_BLOCKED_REASON_NAMES.length).toBeGreaterThan(NO_RESUME_REASON_NAMES.length);
  });

  it('decisão de 19/11: Não ICP, Contatos inválidos e Serviço fora de escopo bloqueiam a recuperação (nomes EXATOS, o SQL compara sem normalizar) mas NÃO são "não retomar"', () => {
    for (const name of ['Não ICP', 'Contatos inválidos', 'Serviço fora de escopo']) {
      expect(RECOVERY_BLOCKED_REASON_NAMES, name).toContain(name);
      expect(isNoResumeReason(name), name).toBe(false);
      expect(NO_RESUME_REASON_NAMES, name).not.toContain(name);
    }
    for (const name of ['Sem interesse', 'Sem budget', 'Preço', 'Cliente']) expect(RECOVERY_BLOCKED_REASON_NAMES).not.toContain(name);
  });
});
