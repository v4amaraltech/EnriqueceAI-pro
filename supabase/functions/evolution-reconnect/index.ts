/**
 * Edge Function: evolution-reconnect (CRON)
 * 
 * Tenta reconectar instâncias em estado error/disconnected.
 * Aplica backoff exponencial para evitar sobrecarga.
 * 
 * Executado a cada 2 minutos via cron.
 * 
 * POST /evolution-reconnect (chamado pelo scheduler do Supabase)
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { isInternalCaller } from "../_shared/auth.ts";
import { getConnectionState, normalizeConnectionState, restartInstance, connectInstance, extractPhoneFromPayload } from "../_shared/evolution.ts";
import { getInstancesForReconnect, updateWhatsAppInstance } from "../_shared/supabase.ts";
// Configuração de backoff exponencial
const BASE_DELAY_MS = 5 * 60 * 1000; // 5 minutos
const MAX_DELAY_MS = 60 * 60 * 1000; // 1 hora
const MAX_ATTEMPTS = 10;
/**
 * Calcula o próximo delay usando backoff exponencial
 */ function calculateNextDelay(attempts) {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempts), MAX_DELAY_MS);
  // Adicionar jitter de ±10%
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}
/**
 * Tenta reconectar uma instância
 */ async function tryReconnect(instance) {
  const { instance_name: instanceName, reconnect_attempts: attempts } = instance;
  console.log(`Attempting to reconnect instance: ${instanceName} (attempt ${attempts + 1})`);
  // 1. Verificar estado atual
  const stateResult = await getConnectionState(instanceName);
  if (stateResult.ok) {
    const currentState = normalizeConnectionState(stateResult.data.instance.state);
    // Se já está conectado, ótimo!
    if (currentState === "connected") {
      const phone = extractPhoneFromPayload(stateResult.data);
      await updateWhatsAppInstance(instance.id, {
        status: "connected",
        phone: phone || instance.phone,
        last_error: null,
        reconnect_attempts: 0,
        next_reconnect_at: null,
        last_seen_at: new Date().toISOString(),
        last_status_payload: stateResult.data
      });
      return {
        success: true,
        status: "connected"
      };
    }
    // Se está conectando, aguardar
    if (currentState === "connecting") {
      return {
        success: false,
        status: "connecting",
        error: "Still connecting"
      };
    }
  }
  // 2. Tentar restart
  const restartResult = await restartInstance(instanceName);
  if (restartResult.ok) {
    // Verificar se conectou após restart
    await new Promise((resolve)=>setTimeout(resolve, 3000)); // Aguardar 3s
    const newStateResult = await getConnectionState(instanceName);
    if (newStateResult.ok) {
      const newState = normalizeConnectionState(newStateResult.data.instance.state);
      if (newState === "connected") {
        const phone = extractPhoneFromPayload(newStateResult.data);
        await updateWhatsAppInstance(instance.id, {
          status: "connected",
          phone: phone || instance.phone,
          last_error: null,
          reconnect_attempts: 0,
          next_reconnect_at: null,
          last_seen_at: new Date().toISOString()
        });
        return {
          success: true,
          status: "connected"
        };
      }
    }
  }
  // 3. Tentar obter novo QR Code (se precisa reconectar manualmente)
  const connectResult = await connectInstance(instanceName);
  if (connectResult.ok && connectResult.data.base64) {
    // Precisa escanear QR novamente
    await updateWhatsAppInstance(instance.id, {
      status: "connecting",
      qr_base64: connectResult.data.base64,
      last_error: "Requires new QR scan",
      reconnect_attempts: attempts + 1,
      next_reconnect_at: null
    });
    return {
      success: false,
      status: "connecting",
      error: "Requires new QR scan"
    };
  }
  // 4. Falhou - agendar próxima tentativa com backoff
  const nextDelay = calculateNextDelay(attempts);
  const nextReconnectAt = new Date(Date.now() + nextDelay);
  // Se atingiu máximo de tentativas, parar de tentar automaticamente
  if (attempts >= MAX_ATTEMPTS) {
    await updateWhatsAppInstance(instance.id, {
      status: "error",
      last_error: "Max reconnect attempts reached",
      reconnect_attempts: attempts + 1,
      next_reconnect_at: null
    });
    return {
      success: false,
      status: "error",
      error: "Max reconnect attempts reached"
    };
  }
  await updateWhatsAppInstance(instance.id, {
    status: "error",
    last_error: stateResult.ok ? "Failed to reconnect" : stateResult.error,
    reconnect_attempts: attempts + 1,
    next_reconnect_at: nextReconnectAt.toISOString()
  });
  return {
    success: false,
    status: "error",
    error: `Scheduled next attempt at ${nextReconnectAt.toISOString()}`
  };
}
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
    console.log("Running Evolution reconnect job...");
    // Buscar instâncias que precisam de reconexão
    const instances = await getInstancesForReconnect();
    if (instances.length === 0) {
      console.log("No instances need reconnection");
      return jsonResponse({
        processed: 0,
        message: "No instances need reconnection",
        checked_at: new Date().toISOString()
      });
    }
    console.log(`Found ${instances.length} instances to reconnect`);
    const results = [];
    // Processar cada instância
    for (const instance of instances){
      try {
        const result = await tryReconnect(instance);
        results.push({
          instance_name: instance.instance_name,
          ...result
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        results.push({
          instance_name: instance.instance_name,
          success: false,
          status: "error",
          error: message
        });
      }
    }
    const successCount = results.filter((r)=>r.success).length;
    const failureCount = results.filter((r)=>!r.success).length;
    console.log(`Reconnect job completed: ${successCount} success, ${failureCount} failures`);
    return jsonResponse({
      processed: instances.length,
      success: successCount,
      failures: failureCount,
      results,
      checked_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error during reconnect job:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(message, 500);
  }
});
