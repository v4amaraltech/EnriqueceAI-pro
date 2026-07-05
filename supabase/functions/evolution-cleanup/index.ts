/**
 * Edge Function: evolution-cleanup (CRON)
 *
 * Remove instâncias da Evolution API que não foram conectadas após um período.
 * Evita sobrecarga no servidor da Evolution com instâncias órfãs.
 *
 * Executado periodicamente via cron.
 *
 * POST /evolution-cleanup (chamado pelo scheduler)
 * GET  /evolution-cleanup (manual)
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  APP_INSTANCE_NAME_RE,
  fetchInstance,
  listInstanceNames,
  purgeInstance,
} from '../_shared/evolution.ts';
import { getStaleInstances, deleteWhatsAppInstance, getAllTrackedInstanceNames } from '../_shared/supabase.ts';

const STALE_THRESHOLD_MINUTES = 10;

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    console.log(`Running evolution-cleanup (threshold: ${STALE_THRESHOLD_MINUTES}min)...`);

    const staleInstances = await getStaleInstances(STALE_THRESHOLD_MINUTES);

    console.log(`Found ${staleInstances.length} stale instance(s) to clean up`);

    const results: Array<{
      instance_name: string;
      status: string;
      evolution_deleted: boolean;
      db_deleted: boolean;
      error?: string;
    }> = [];

    for (const instance of staleInstances) {
      const instanceName = instance.instance_name as string;
      const instanceId = instance.id as string;
      const instanceStatus = instance.status as string;

      console.log(`Cleaning up: ${instanceName} (status: ${instanceStatus})`);

      let evolutionDeleted = false;
      let dbDeleted = false;
      let error: string | undefined;

      try {
        // Verificar se a instância existe na Evolution
        const fetchResult = await fetchInstance(instanceName);

        if (fetchResult.ok) {
          // Check if instance is actually connected in Evolution — don't delete if so
          const instanceData = fetchResult.data as Record<string, unknown>;
          const connStatus = (instanceData as { connectionStatus?: string }).connectionStatus;
          if (connStatus === 'open') {
            console.log(`Instance ${instanceName} is connected in Evolution, skipping cleanup`);
            results.push({ instance_name: instanceName, status: instanceStatus, evolution_deleted: false, db_deleted: false, error: 'Instance is connected in Evolution' });
            continue;
          }

          evolutionDeleted = await purgeInstance(instanceName, 3);

          if (!evolutionDeleted) {
            error = 'Evolution purge did not confirm removal';
            console.warn(`Failed to purge ${instanceName} from Evolution`);
            results.push({ instance_name: instanceName, status: instanceStatus, evolution_deleted: false, db_deleted: false, error });
            continue;
          }
        } else {
          // Instância não existe na Evolution, só limpar do banco
          evolutionDeleted = true;
          console.log(`Instance ${instanceName} not found in Evolution, cleaning DB only`);
        }

        // Only remove from DB if Evolution delete succeeded (or instance doesn't exist in Evolution)
        dbDeleted = await deleteWhatsAppInstance(instanceId);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        console.error(`Error cleaning up ${instanceName}:`, error);
      }

      results.push({
        instance_name: instanceName,
        status: instanceStatus,
        evolution_deleted: evolutionDeleted,
        db_deleted: dbDeleted,
        error,
      });
    }

    const cleanedCount = results.filter((r) => r.db_deleted).length;
    console.log(`Cleanup complete: ${cleanedCount}/${staleInstances.length} instances removed`);

    // -----------------------------------------------------------------------
    // Evolution-side orphan reaper
    // -----------------------------------------------------------------------
    // Enumerate Evolution directly and purge any ea_* instance that is NOT the
    // tracked keeper in our DB. Skips:
    //   - instances connected (open) in Evolution — still in use
    //   - canonical names mid-connect (create-instance drops the DB row while
    //     pairing a fresh QR; suffixed duplicates are always safe to reap)
    const SUFFIXED_INSTANCE_RE = /^ea_[0-9a-f]{8}_[0-9a-f]{8}_[0-9a-z]{1,8}$/;

    const evoNames = await listInstanceNames();
    const trackedNames = new Set(await getAllTrackedInstanceNames());

    const reaped: Array<{ instance_name: string; gone: boolean; skipped?: string }> = [];
    for (const name of evoNames) {
      if (!APP_INSTANCE_NAME_RE.test(name)) continue;
      if (trackedNames.has(name)) continue;

      const fetchResult = await fetchInstance(name);
      if (fetchResult.ok) {
        const connStatus = (fetchResult.data as { connectionStatus?: string }).connectionStatus;
        if (connStatus === 'open') {
          console.log(`[reaper] Skipping ${name} — connected in Evolution`);
          reaped.push({ instance_name: name, gone: false, skipped: 'connected in Evolution' });
          continue;
        }
        if (connStatus === 'connecting' && !SUFFIXED_INSTANCE_RE.test(name)) {
          console.log(`[reaper] Skipping ${name} — mid-connect canonical`);
          reaped.push({ instance_name: name, gone: false, skipped: 'mid-connect canonical' });
          continue;
        }
      }

      const gone = await purgeInstance(name, 3);
      console.log(`[reaper] Orphan ${name} → ${gone ? 'removed' : 'still present'}`);
      reaped.push({ instance_name: name, gone });
    }
    const reapedCount = reaped.filter((r) => r.gone).length;
    console.log(`Reaper complete: ${reapedCount}/${reaped.length} orphan(s) removed`);

    return jsonResponse({
      cleaned: cleanedCount,
      total_stale: staleInstances.length,
      orphans_reaped: reapedCount,
      orphans: reaped,
      details: results,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error during evolution-cleanup:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 500);
  }
});
