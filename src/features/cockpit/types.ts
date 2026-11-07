export const COCKPIT_TABS = ['tarefas', 'leads', 'dashboard', 'metas', 'closers'] as const;
export type CockpitTab = (typeof COCKPIT_TABS)[number];

export interface CockpitSdrOption {
  userId: string;
  name: string;
}

/** Quem está olhando e de quem são os dados exibidos. */
export interface CockpitViewer {
  viewerId: string;
  orgId: string;
  isManager: boolean;
  /** SDR cujos dados aparecem nas abas (o próprio usuário, se for SDR). */
  targetUserId: string;
  targetName: string;
  /** Opções do seletor (só gestor). */
  sdrOptions: CockpitSdrOption[];
}
