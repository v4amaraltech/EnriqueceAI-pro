import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { resolveUserProfiles } from '@/lib/auth/user-directory';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchSdrIds } from '@/features/dashboard/services/sdr-pace.service';

import type { CockpitSdrOption, CockpitViewer } from '../types';
import { pickCockpitTarget } from '../utils/cockpit-target';

/**
 * Opções do seletor do gestor: os SDRs em ordem alfabética e, no topo, o próprio gestor
 * ("<Nome> (você)"). Org sem SDR: lista vazia (o gestor já cai nele mesmo, sem seletor).
 */
export function buildSdrOptions(input: {
  isManager: boolean;
  viewerId: string;
  sdrIds: string[];
  nameOf: (id: string) => string;
}): CockpitSdrOption[] {
  const { isManager, viewerId, sdrIds, nameOf } = input;
  const sdrs = sdrIds
    .map((id) => ({ userId: id, name: nameOf(id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (!isManager || sdrs.length === 0) return sdrs;
  return [{ userId: viewerId, name: `${nameOf(viewerId)} (você)` }, ...sdrs.filter((o) => o.userId !== viewerId)];
}

/** Resolve quem vê o Cockpit e de quem são os dados (ver `pickCockpitTarget`). */
export async function resolveCockpitViewer(requestedSdr: string | null | undefined): Promise<CockpitViewer> {
  const { userId, orgId, role } = await requireAuthWithMember();
  const isManager = role === 'manager';

  let sdrIds: string[] = [];
  if (isManager) {
    const supabase = await createServerSupabaseClient();
    sdrIds = await fetchSdrIds(supabase, orgId);
  }

  const targetUserId = pickCockpitTarget({ isManager, viewerId: userId, requested: requestedSdr, sdrIds });
  const profiles = await resolveUserProfiles([...new Set([userId, targetUserId, ...sdrIds])]);
  const nameOf = (id: string) => profiles.get(id)?.displayName ?? id.slice(0, 8);

  return {
    viewerId: userId,
    orgId,
    isManager,
    targetUserId,
    targetName: nameOf(targetUserId),
    sdrOptions: buildSdrOptions({ isManager, viewerId: userId, sdrIds, nameOf }),
  };
}
