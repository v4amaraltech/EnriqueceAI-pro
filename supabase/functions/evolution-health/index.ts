/**
 * Edge Function: evolution-health (CRON)
 * 
 * Verifica se a Evolution API está online.
 * Se offline, marca todas as instâncias conectadas como error.
 * 
 * Executado a cada 5 minutos via cron.
 * 
 * POST /evolution-health (chamado pelo scheduler do Supabase)
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { isInternalCaller } from "../_shared/auth.ts";
import { checkHealth } from "../_shared/evolution.ts";
import { markInstancesAsEvolutionDown, getServiceClient } from "../_shared/supabase.ts";
serve(async (req)=>{
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  // Este endpoint pode ser chamado via POST (cron) ou GET (manual)
  if (req.method !== "POST" && req.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }
  // Pista 5: só chamadas internas (service_role / CRON_SECRET).
  if (!isInternalCaller(req, { allowLegacyAnon: true })) {
    return errorResponse('Unauthorized', 401);
  }
  try {
    console.log("Running Evolution health check...");
    // Verificar se Evolution API está online
    const isHealthy = await checkHealth();
    if (isHealthy) {
      console.log("Evolution API is healthy");
      return jsonResponse({
        healthy: true,
        message: "Evolution API is online",
        checked_at: new Date().toISOString()
      });
    }
    // Evolution está offline - marcar instâncias conectadas como error
    console.warn("Evolution API is DOWN! Marking connected instances as error...");
    const affectedCount = await markInstancesAsEvolutionDown();
    console.log(`Marked ${affectedCount} instances as EVOLUTION_DOWN`);
    // Registrar log de problema
    const client = getServiceClient();
    await client.from("provider_events").insert({
      organization_id: "00000000-0000-0000-0000-000000000000",
      provider: "evolution",
      event_id: `health_check_${Date.now()}`,
      event_type: "HEALTH_CHECK_FAILED",
      payload: {
        healthy: false,
        affected_instances: affectedCount,
        checked_at: new Date().toISOString()
      }
    }).catch(()=>{
    // Ignore errors when logging system events
    });
    return jsonResponse({
      healthy: false,
      message: "Evolution API is offline",
      affected_instances: affectedCount,
      checked_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error during health check:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(message, 500);
  }
});
