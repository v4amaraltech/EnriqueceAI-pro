import { describe, expect, it } from 'vitest';

import { canEditTemplate } from './template-permissions';

describe('canEditTemplate', () => {
  const own = { is_system: false, created_by: 'sdr-1' };
  const other = { is_system: false, created_by: 'sdr-2' };
  const system = { is_system: true, created_by: null };

  it('SDR edita o próprio template', () => {
    expect(canEditTemplate(own, 'sdr-1', 'sdr')).toBe(true);
  });

  it('SDR não edita template de outra pessoa', () => {
    expect(canEditTemplate(other, 'sdr-1', 'sdr')).toBe(false);
  });

  it('gestor edita template de qualquer pessoa', () => {
    expect(canEditTemplate(other, 'manager-1', 'manager')).toBe(true);
  });

  it('ninguém edita template de sistema', () => {
    expect(canEditTemplate(system, 'sdr-1', 'sdr')).toBe(false);
    expect(canEditTemplate(system, 'manager-1', 'manager')).toBe(false);
  });
});
