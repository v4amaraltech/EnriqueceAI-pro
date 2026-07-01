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
import { normalizeConnectionState, extractPhoneFromPayload, fetchInstance } from "../_shared/evolution.ts";
import { getWhatsAppInstanceByName, updateWhatsAppInstanceByName, eventExists, createProviderEvent } from "../_shared/supabase.ts";
import { parseInboundMessage, captureInboundReply } from "../_shared/whatsapp-reply.ts";
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
    // Only store full payload for connection/qrcode events — message events
    // generate ~153KB each and are never re-read after processing
    const isMessageEvent = event === 'messages.upsert' || event === 'MESSAGES_UPSERT'
      || event === 'messages.update' || event === 'MESSAGES_UPDATE';
    const storedPayload = isMessageEvent
      ? { event, instance: instanceName, trimmed: true }
      : payload;
    await createProviderEvent(instance.organization_id, "evolution", eventId, event, storedPayload);
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
            // Try to extract phone from the webhook payload first; fall back
            // to fetchInstance when Evolution sends a minimal payload (newer
            // versions only include {state, instanceName} on connection.update).
            let phone = extractPhoneFromPayload(payload);
            if (!phone) {
              const fetchResult = await fetchInstance(instanceName);
              if (fetchResult.ok) {
                phone = extractPhoneFromPayload(fetchResult.data as Record<string, unknown>);
              }
            }
            if (phone) {
              updates.phone = phone;
            }
          } else if (normalizedStatus === "disconnected") {
            // Mark as disconnected instead of deleting the row. Deleting causes
            // the next "Conectar" click to race with the orphaned Evolution
            // instance ("already in use" → retry path → flapping instance
            // names), and erases the user's history (last_seen, phone). The
            // create-instance flow already destroys + recreates on reconnect.
            console.log(`[webhook] Instance ${instanceName} disconnected — marking, not deleting`);
            updates.qr_base64 = null;
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
          // Capturar resposta do lead: registra interação 'replied', para as
          // cadências ativas e notifica o SDR dono (que ainda toca o som).
          // Best-effort — falha aqui não pode quebrar o ack do webhook.
          try {
            const reply = parseInboundMessage(data);
            if (reply) {
              const result = await captureInboundReply(instance.organization_id, reply);
              if (result.status === "recorded") {
                console.log(`[evolution-webhook] WhatsApp reply recorded lead=${result.leadId} instance=${instanceName}`);
              } else if (result.status === "no_lead") {
                console.warn(`[evolution-webhook] Inbound WhatsApp with no matching lead phone=${reply.phone} org=${instance.organization_id}`);
              }
            }
          } catch (replyErr) {
            console.error("[evolution-webhook] reply capture failed:", replyErr);
          }
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
    console.error("[evolution-webhook] Error processing webhook:", error);
    // Return 200 to prevent infinite retries, but log error server-side
    return jsonResponse({
      received: true,
      error: "processing_error"
    });
  }
});
