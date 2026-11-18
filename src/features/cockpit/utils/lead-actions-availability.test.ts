import { describe, expect, it } from 'vitest';

import { leadActionsAvailability } from './lead-actions-availability';

describe('leadActionsAvailability', () => {
  it.each(['new', 'contacted'])('%s: as três ações, com "Desqualificar"', (status) => {
    expect(leadActionsAvailability(status)).toMatchObject({ schedule: true, callback: true, disqualify: true, disqualifyLabel: 'Desqualificar', disqualifyLongLabel: 'Desqualificar lead' });
  });
  it('unqualified: as três, e a terceira vira "Mudar motivo de perda"', () => {
    expect(leadActionsAvailability('unqualified')).toMatchObject({ schedule: true, callback: true, disqualify: true, disqualifyLabel: 'Mudar motivo de perda', disqualifyLongLabel: 'Mudar motivo de perda' });
  });
  it('qualified: sem Desqualificar nem troca de motivo', () => {
    expect(leadActionsAvailability('qualified')).toMatchObject({ schedule: true, callback: true, disqualify: false });
  });
  it.each(['won', 'archived'])('%s: nenhuma ação', (status) => {
    expect(leadActionsAvailability(status)).toMatchObject({ schedule: false, callback: false, disqualify: false });
  });
});
