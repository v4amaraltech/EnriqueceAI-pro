/**
 * Edge Function: evolution-status
 * 
 * Consulta o status de conexão da instância WhatsApp na Evolution API.
 * Atualiza o banco com o estado atual.
 * 
 * Requer autenticação (qualquer membro da organização).
 * 
 * GET /evolution-status
 * Response: { status, phone, instance_name }
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAuthContext } from "../_shared/auth.ts";
import { getConnectionState, normalizeConnectionState, extractPhoneFromPayload, fetchInstance, connectInstance } from "../_shared/evolution.ts";
import { getWhatsAppInstance, updateWhatsAppInstance } from "../_shared/supabase.ts";
serve(async (req)=>{
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  // Validar método
  if (req.method !== "GET" && req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }
  // Validar autenticação
  const authResult = await getAuthContext(req);
  if (!authResult.ok) {
    return authResult.response;
  }
  const { organizationId } = authResult.context;
  try {
    // Buscar instância da organização
    const instance = await getWhatsAppInstance(organizationId);
    if (!instance) {
      return jsonResponse({
        status: "not_configured",
        message: "No WhatsApp instance configured"
      });
    }
    // Consultar estado na Evolution API
    console.log("[evolution-status] Checking state for:", instance.instance_name);
    const stateResult = await getConnectionState(instance.instance_name);
    if (!stateResult.ok) {
      console.error("[evolution-status] Error fetching state:", stateResult.error);
      // Se a instância não existe na Evolution mas existe no nosso banco, 
      // não damos erro imediato, tentamos retornar o que temos.
      return jsonResponse({
        status: instance.status,
        instance_name: instance.instance_name,
        qr_base64: instance.qr_base64
      });
    }
    const evolutionState = stateResult.data.instance.state;
    const normalizedStatus = normalizeConnectionState(evolutionState);
    console.log("[evolution-status] Normalized status:", normalizedStatus);
    let currentQr = instance.qr_base64;
    // Se estiver em modo de conexão, tentar garantir que temos um QR Code
    if (normalizedStatus === "connecting" || normalizedStatus === "disconnected") {
      const connectResult = await connectInstance(instance.instance_name);
      if (connectResult.ok && connectResult.data.base64) {
        currentQr = connectResult.data.base64;
        console.log("[evolution-status] Refreshed QR Code from Evolution");
      }
    }
    // Tentar extrair telefone se conectado
    let phone = instance.phone;
    if (normalizedStatus === "connected" && !phone) {
      // Buscar detalhes da instância para obter o telefone
      const instanceDetails = await fetchInstance(instance.instance_name);
      if (instanceDetails.ok) {
        phone = extractPhoneFromPayload(instanceDetails.data);
      }
    }
    // Atualizar banco com estado atual
    const updates = {
      status: normalizedStatus,
      last_seen_at: new Date().toISOString(),
      last_status_payload: stateResult.data,
      qr_base64: currentQr
    };
    if (normalizedStatus === "connected") {
      updates.last_error = null;
      updates.qr_base64 = null;
      updates.reconnect_attempts = 0;
      updates.next_reconnect_at = null;
      if (phone) {
        updates.phone = phone;
      }
    }
    await updateWhatsAppInstance(instance.id, updates);
    return jsonResponse({
      status: normalizedStatus,
      phone: normalizedStatus === "connected" ? phone : null,
      instance_name: instance.instance_name,
      qr_base64: normalizedStatus === "connecting" ? currentQr : null
    });
  } catch (error) {
    console.error("Error checking status:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(message, 500);
  }
});
