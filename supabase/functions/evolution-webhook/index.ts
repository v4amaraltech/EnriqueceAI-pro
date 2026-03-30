/**
 * Edge Function: evolution-webhook
 * 
 * Recebe webhooks da Evolution API.
 * Valida secret, registra eventos e atualiza estado da instância.
 * 
 * POST /evolution-webhook
 * Headers: X-EVOLUTION-SECRET
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { validateWebhookSecret } from "../_shared/auth.ts";
import { normalizeConnectionState, extractPhoneFromPayload } from "../_shared/evolution.ts";
import { getWhatsAppInstanceByName, updateWhatsAppInstanceByName, deleteWhatsAppInstance, eventExists, createProviderEvent } from "../_shared/supabase.ts";
serve(async (req)=>{
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  // Validar método
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }
  // Validar secret
  if (!validateWebhookSecret(req)) {
    console.error("Invalid webhook secret");
    return errorResponse("Unauthorized", 401);
  }
  try {
    const payload = await req.json();
    const { event, instance: instanceName, data } = payload;
    if (!event || !instanceName) {
      return errorResponse("Missing event or instance in payload", 400);
    }
    console.log(`Received webhook: ${event} for instance: ${instanceName}`);
    // Buscar instância no banco
    const instance = await getWhatsAppInstanceByName(instanceName);
    if (!instance) {
      console.warn(`Instance not found: ${instanceName}`);
      // Mesmo assim retornar 200 para não causar retries
      return jsonResponse({
        received: true,
        warning: "Instance not found"
      });
    }
    // Gerar event_id único para idempotência
    const eventId = `${instanceName}_${event}_${payload.date_time || Date.now()}`;
    // Verificar se evento já foi processado
    const alreadyProcessed = await eventExists("evolution", eventId);
    if (alreadyProcessed) {
      console.log(`Event already processed: ${eventId}`);
      return jsonResponse({
        received: true,
        duplicate: true
      });
    }
    // Registrar evento
    await createProviderEvent(instance.organization_id, "evolution", eventId, event, payload);
    // Processar evento conforme tipo
    switch(event){
      case "CONNECTION_UPDATE":
      case "connection.update":
        {
          const state = data?.state || data?.status || "";
          const normalizedStatus = normalizeConnectionState(state);
          const updates = {
            status: normalizedStatus,
            last_seen_at: new Date().toISOString(),
            last_status_payload: payload
          };
          if (normalizedStatus === "connected") {
            updates.last_error = null;
            updates.qr_base64 = null;
            updates.reconnect_attempts = 0;
            updates.next_reconnect_at = null;
            // Tentar extrair telefone
            const phone = extractPhoneFromPayload(payload);
            if (phone) {
              updates.phone = phone;
            }
          } else if (normalizedStatus === "disconnected") {
            // User disconnected from their phone — delete instance entirely
            console.log(`[webhook] Instance ${instanceName} disconnected — deleting from DB`);
            const instanceId = instance.id as string;
            await deleteWhatsAppInstance(instanceId);
            break;
          }
          await updateWhatsAppInstanceByName(instanceName, updates);
          break;
        }
      case "QRCODE_UPDATED":
      case "qrcode.updated":
        {
          const qrBase64 = data?.qrcode?.base64 || data?.base64;
          if (qrBase64) {
            await updateWhatsAppInstanceByName(instanceName, {
              qr_base64: qrBase64,
              status: "connecting",
              last_seen_at: new Date().toISOString()
            });
          }
          break;
        }
      case "MESSAGES_UPSERT":
      case "messages.upsert":
        {
          // Atualizar last_seen_at para indicar que instância está ativa
          await updateWhatsAppInstanceByName(instanceName, {
            last_seen_at: new Date().toISOString(),
            status: "connected"
          });
          break;
        }
      case "MESSAGES_UPDATE":
      case "messages.update":
        {
          // Atualizar timestamp
          await updateWhatsAppInstanceByName(instanceName, {
            last_seen_at: new Date().toISOString()
          });
          break;
        }
      default:
        console.log(`Unhandled event type: ${event}`);
    }
    return jsonResponse({
      received: true,
      event,
      instance: instanceName
    });
  } catch (error) {
    console.error("Error processing webhook:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    // Retornar 200 mesmo em erro para evitar retries infinitos
    return jsonResponse({
      received: true,
      error: message
    });
  }
});
