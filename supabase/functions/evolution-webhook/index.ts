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
import { buildEvolutionEventId, isMessageEvent } from "../_shared/evolution-events.ts";
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
  let payload;
  try {
    payload = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  try {
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
    // whatsapp_instances.org_id — `instance.organization_id` não existe e vinha
    // undefined: a busca do lead filtrava org_id=undefined e NENHUMA resposta de
    // WhatsApp era registrada.
    const orgId: string = instance.org_id;
    // Gerar event_id único para idempotência (mensagens: id do WhatsApp)
    const eventId = buildEvolutionEventId(instanceName, event, payload);
    // Verificar se evento já foi processado
    const alreadyProcessed = await eventExists("evolution", eventId);
    if (alreadyProcessed) {
      console.log(`Event already processed: ${eventId}`);
      return jsonResponse({
        received: true,
        duplicate: true
      });
    }
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
          // Falha aqui sobe para o catch: o evento NÃO é marcado como processado
          // e a resposta é 5xx, para a Evolution reenviar (captureInboundReply é
          // idempotente pelo id da mensagem).
          const reply = parseInboundMessage(data);
          if (reply) {
            const result = await captureInboundReply(orgId, reply);
            if (result.status === "recorded") {
              console.log(`[evolution-webhook] WhatsApp reply recorded lead=${result.leadId} instance=${instanceName}`);
            } else if (result.status === "no_lead") {
              console.warn(`[evolution-webhook] Inbound WhatsApp with no matching lead phone=${reply.phone} org=${orgId}`);
            }
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
    // Só marca como processado depois de processar: antes era gravado primeiro,
    // e uma falha no meio deixava o evento "processado" sem ter sido.
    // Only store full payload for connection/qrcode events — message events
    // generate ~153KB each and are never re-read after processing
    const storedPayload = isMessageEvent(event)
      ? { event, instance: instanceName, trimmed: true }
      : payload;
    await createProviderEvent(orgId, "evolution", eventId, event, storedPayload);
    return jsonResponse({
      received: true,
      event,
      instance: instanceName
    });
  } catch (error) {
    console.error("[evolution-webhook] Error processing webhook:", error);
    // 5xx para a Evolution reenviar. Antes devolvia 200 e a mensagem se perdia
    // sem alerta. O evento não foi gravado em provider_events, então o reenvio
    // não é descartado como duplicado.
    return jsonResponse({
      received: false,
      error: "processing_error"
    }, 500);
  }
});
