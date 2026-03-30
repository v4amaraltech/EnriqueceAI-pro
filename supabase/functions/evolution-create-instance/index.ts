/**
 * Edge Function: evolution-create-instance
 * 
 * Cria uma nova instância WhatsApp na Evolution API e salva no banco.
 * 
 * Requer autenticação (qualquer membro da organização).
 * 
 * POST /evolution-create-instance
 * Response: { instance_name, qr_base64, status }
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAuthContext } from "../_shared/auth.ts";
import { generateInstanceName, createInstance, connectInstance, getConnectionState, normalizeConnectionState, extractPhoneFromPayload, fetchInstance, logoutInstance, deleteInstance } from "../_shared/evolution.ts";
import { getWhatsAppInstance, createWhatsAppInstance, updateWhatsAppInstance, deleteWhatsAppInstance } from "../_shared/supabase.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const EVOLUTION_WEBHOOK_SECRET = Deno.env.get("EVOLUTION_WEBHOOK_SECRET") || "";
serve(async (req)=>{
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  // Validar método
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }
  // Validar autenticação
  const authResult = await getAuthContext(req);
  if (!authResult.ok) {
    return authResult.response;
  }
  const { organizationId, userId } = authResult.context;
  console.log("[create-instance] Auth OK, org:", organizationId, "user:", userId);
  try {
    // Verificar se já existe uma instância para este usuário (ou org default)
    console.log("[create-instance] Checking existing instance for user...");
    const existingInstance = await getWhatsAppInstance(organizationId, userId);
    if (existingInstance) {
      console.log("[create-instance] Found existing instance:", existingInstance.instance_name, "status:", existingInstance.status);
      // ALWAYS destroy + recreate when user clicks "Conectar"
      // This ensures a completely fresh session for the user's phone
      console.log("[create-instance] Destroying existing instance for fresh start...");
      await logoutInstance(existingInstance.instance_name);
      await deleteInstance(existingInstance.instance_name);
      await deleteWhatsAppInstance(existingInstance.id);
      console.log("[create-instance] Old instance destroyed, will create new one below");
      // Fall through to create new instance
    }
    // Criar nova instância
    console.log("[create-instance] Creating new instance...");
    const instanceName = generateInstanceName(organizationId);
    const webhookUrl = `${SUPABASE_URL}/functions/v1/evolution-webhook`;
    // Criar na Evolution API
    console.log("[create-instance] Calling Evolution API to create:", instanceName);
    const createResult = await createInstance(instanceName, webhookUrl, EVOLUTION_WEBHOOK_SECRET);
    if (!createResult.ok) {
      // Handle "already in use" — orphaned instance exists in Evolution but not in our DB
      const isAlreadyInUse = createResult.error?.includes("already in use");
      if (isAlreadyInUse) {
        console.log("[create-instance] Instance already exists in Evolution API, recovering...");
        // Check actual connection state in Evolution API
        const stateResult = await getConnectionState(instanceName);
        const evolutionState = stateResult.ok ? normalizeConnectionState(stateResult.data.instance.state) : "error";
        console.log("[create-instance] Orphan instance state:", evolutionState);

        if (evolutionState === "connected") {
          // Orphaned instance connected in Evolution but no DB record.
          // User explicitly clicked "Conectar" — force logout and get fresh QR.
          console.log("[create-instance] Orphan connected, forcing logout for fresh QR...");
          await logoutInstance(instanceName);
          const freshConnect = await connectInstance(instanceName);
          const freshQr = freshConnect.ok ? (freshConnect.data.base64 || null) : null;
          const savedInstance = await createWhatsAppInstance(organizationId, instanceName, freshQr || undefined, userId);
          if (!savedInstance) {
            return errorResponse("Failed to save instance to database", 500);
          }
          return jsonResponse({
            instance_name: instanceName,
            qr_base64: freshQr,
            status: "connecting"
          });
        }

        // Not connected — try to get QR code for scanning
        const connectResult = await connectInstance(instanceName);
        const recoveredQr = connectResult.ok ? (connectResult.data.base64 || null) : null;
        const savedInstance = await createWhatsAppInstance(organizationId, instanceName, recoveredQr || undefined, userId);
        if (!savedInstance) {
          return errorResponse("Failed to save recovered instance to database", 500);
        }
        return jsonResponse({
          instance_name: instanceName,
          qr_base64: recoveredQr,
          status: "connecting"
        });
      }
      console.error("[create-instance] Evolution API error:", createResult.error);
      return errorResponse(`Failed to create Evolution instance: ${createResult.error}`, 500);
    }
    console.log("[create-instance] Evolution API success");
    // Extrair QR code se disponível
    const qrBase64 = createResult.data.qrcode?.base64 || null;
    console.log("[create-instance] QR from create:", qrBase64 ? "yes" : "no");
    // Salvar no banco
    console.log("[create-instance] Saving to database...");
    const savedInstance = await createWhatsAppInstance(organizationId, instanceName, qrBase64 || undefined, userId);
    if (!savedInstance) {
      console.error("[create-instance] Failed to save to database");
      return errorResponse("Failed to save instance to database", 500);
    }
    console.log("[create-instance] Saved to DB, id:", savedInstance.id);
    // Se não veio QR na criação, tentar buscar via connect
    if (!qrBase64) {
      console.log("[create-instance] No QR from create, trying connect...");
      const connectResult = await connectInstance(instanceName);
      if (connectResult.ok && connectResult.data.base64) {
        console.log("[create-instance] Got QR from connect");
        await updateWhatsAppInstance(savedInstance.id, {
          qr_base64: connectResult.data.base64
        });
        return jsonResponse({
          instance_name: instanceName,
          qr_base64: connectResult.data.base64,
          status: "connecting"
        });
      }
      console.log("[create-instance] No QR from connect either");
    }
    console.log("[create-instance] Returning response");
    return jsonResponse({
      instance_name: instanceName,
      qr_base64: qrBase64,
      status: "connecting"
    });
  } catch (error) {
    console.error("[create-instance] Exception:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(message, 500);
  }
});
