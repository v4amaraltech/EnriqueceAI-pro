import { COCKPIT_TABS, type CockpitTab } from '../types';

/**
 * De quem são os dados do Cockpit.
 * - SDR: sempre ele mesmo, ignorando `?sdr=` (não vê outro SDR).
 * - Gestor: o SDR pedido, se for um SDR da org; senão o primeiro SDR da lista;
 *   sem SDR na org, ele mesmo.
 */
export function pickCockpitTarget(input: {
  isManager: boolean;
  viewerId: string;
  requested: string | null | undefined;
  sdrIds: string[];
}): string {
  const { isManager, viewerId, requested, sdrIds } = input;
  if (!isManager) return viewerId;
  if (requested && sdrIds.includes(requested)) return requested;
  return sdrIds[0] ?? viewerId;
}

export function parseCockpitTab(value: string | null | undefined): CockpitTab {
  return (COCKPIT_TABS as readonly string[]).includes(value ?? '') ? (value as CockpitTab) : 'tarefas';
}
