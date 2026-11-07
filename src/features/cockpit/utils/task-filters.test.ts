import { describe, expect, it } from 'vitest';

import type { PendingActivity } from '@/features/activities/types';

import { countByChannel, filterTasks, matchesTaskSearch } from './task-filters';

function task(channel: PendingActivity['channel'], extra: Partial<PendingActivity['lead']> = {}, name = 'Ligação 1'): PendingActivity {
  return {
    channel,
    activityName: name,
    cadenceName: 'Inbound Rede Geral',
    lead: { nome_fantasia: 'Davantti Implementos', razao_social: null, first_name: 'Matheus', last_name: 'Castro', telefone: '(16) 99220-1572', phones: null, ...extra },
  } as unknown as PendingActivity;
}

describe('countByChannel', () => {
  it('conta por canal e soma em Todas', () => {
    const counts = countByChannel([task('phone'), task('phone'), task('whatsapp'), task('email')]);
    expect(counts).toMatchObject({ all: 4, phone: 2, whatsapp: 1, email: 1, linkedin: 0, research: 0 });
  });
});

describe('matchesTaskSearch', () => {
  it('acha por empresa, contato, cadência e tarefa sem acento', () => {
    const t = task('phone');
    expect(matchesTaskSearch(t, 'davantti')).toBe(true);
    expect(matchesTaskSearch(t, 'castro')).toBe(true);
    expect(matchesTaskSearch(t, 'rede geral')).toBe(true);
    expect(matchesTaskSearch(t, 'ligacao')).toBe(true);
    expect(matchesTaskSearch(t, 'outra empresa')).toBe(false);
  });

  it('acha por telefone, inclusive na lista de telefones', () => {
    expect(matchesTaskSearch(task('phone'), '99220')).toBe(true);
    const t = task('phone', { telefone: null, phones: [{ tipo: 'celular', numero: '+55 51 98550-4502' }] });
    expect(matchesTaskSearch(t, '98550')).toBe(true);
  });
});

describe('filterTasks', () => {
  it('filtra pelo canal e pela busca juntos', () => {
    const list = [task('phone'), task('whatsapp'), task('phone', { nome_fantasia: 'FMSTUDIO' })];
    expect(filterTasks(list, 'phone', '')).toHaveLength(2);
    expect(filterTasks(list, 'phone', 'fmstudio')).toHaveLength(1);
    expect(filterTasks(list, 'all', '')).toHaveLength(3);
  });
});
