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
import { deleteInstance, logoutInstance, fetchInstance } from '../_shared/evolution.ts';
import { getStaleInstances, deleteWhatsAppInstance } from '../_shared/supabase.ts';

const STALE_THRESHOLD_MINUTES = 2;

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    console.log(`Running evolution-cleanup (threshold: ${STALE_THRESHOLD_MINUTES}min)...`);

    const staleInstances = await getStaleInstances(STALE_THRESHOLD_MINUTES);

    if (staleInstances.length === 0) {
      console.log('No stale instances found');
      return jsonResponse({
        cleaned: 0,
        message: 'No stale instances to clean up',
        checked_at: new Date().toISOString(),
      });
    }

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
          // Tentar logout primeiro (desconectar sessão WhatsApp)
          await logoutInstance(instanceName);
          // Depois deletar a instância da Evolution
          const deleteResult = await deleteInstance(instanceName);
          evolutionDeleted = deleteResult.ok;

          if (!deleteResult.ok) {
            error = deleteResult.error;
            console.warn(`Failed to delete ${instanceName} from Evolution: ${deleteResult.error}`);
          }
        } else {
          // Instância não existe na Evolution, só limpar do banco
          evolutionDeleted = true;
          console.log(`Instance ${instanceName} not found in Evolution, cleaning DB only`);
        }

        // Remover do banco de dados
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

    return jsonResponse({
      cleaned: cleanedCount,
      total_stale: staleInstances.length,
      details: results,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error during evolution-cleanup:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 500);
  }
});
