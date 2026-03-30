/**
 * Edge Function: evolution-qrcode
 * 
 * Busca/atualiza o QR Code de uma instância WhatsApp.
 * Se o QR estiver vazio ou expirado, solicita novo da Evolution API.
 * 
 * Requer autenticação (qualquer membro da organização).
 * 
 * GET /evolution-qrcode
 * Response: { qr_base64, status }
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAuthContext } from "../_shared/auth.ts";
import { connectInstance, getConnectionState, normalizeConnectionState } from "../_shared/evolution.ts";
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
  const { organizationId, userId } = authResult.context;
  try {
    // Buscar instância do usuário (ou org default)
    const instance = await getWhatsAppInstance(organizationId, userId);
    if (!instance) {
      return errorResponse("No WhatsApp instance found. Create one first.", 404);
    }
    // Se já está conectado, não precisa de QR
    if (instance.status === "connected") {
      return jsonResponse({
        status: "connected",
        phone: instance.phone,
        message: "Instance already connected"
      });
    }
    // Verificar estado atual na Evolution
    const stateResult = await getConnectionState(instance.instance_name);
    if (stateResult.ok) {
      const currentState = normalizeConnectionState(stateResult.data.instance.state);
      // Se conectou, atualizar status
      if (currentState === "connected") {
        await updateWhatsAppInstance(instance.id, {
          status: "connected",
          qr_base64: null,
          last_error: null,
          last_seen_at: new Date().toISOString()
        });
        return jsonResponse({
          status: "connected",
          message: "Instance connected successfully"
        });
      }
    }
    // Solicitar novo QR Code
    const connectResult = await connectInstance(instance.instance_name);
    if (!connectResult.ok) {
      // Atualizar erro no banco
      await updateWhatsAppInstance(instance.id, {
        last_error: connectResult.error
      });
      return errorResponse(`Failed to get QR code: ${connectResult.error}`, 500);
    }
    const qrBase64 = connectResult.data.base64 || null;
    // Atualizar QR no banco
    if (qrBase64) {
      await updateWhatsAppInstance(instance.id, {
        qr_base64: qrBase64,
        status: "connecting",
        last_error: null
      });
    }
    return jsonResponse({
      qr_base64: qrBase64,
      status: "connecting",
      instance_name: instance.instance_name
    });
  } catch (error) {
    console.error("Error getting QR code:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(message, 500);
  }
});
