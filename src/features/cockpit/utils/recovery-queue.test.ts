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
});
