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
import { generateInstanceName, createInstance, connectInstance } from "../_shared/evolution.ts";
import { getWhatsAppInstance, createWhatsAppInstance, updateWhatsAppInstance } from "../_shared/supabase.ts";
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
  const { organizationId } = authResult.context;
  console.log("[create-instance] Auth OK, org:", organizationId);
  try {
    // Verificar se já existe uma instância para esta organização
    console.log("[create-instance] Checking existing instance...");
    const existingInstance = await getWhatsAppInstance(organizationId);
    if (existingInstance) {
      console.log("[create-instance] Found existing instance:", existingInstance.instance_name, "status:", existingInstance.status);
      // Se já está conectado, retornar os dados existentes
      if (existingInstance.status === "connected") {
        console.log("[create-instance] Already connected, returning");
        return jsonResponse({
          instance_name: existingInstance.instance_name,
          status: existingInstance.status,
          phone: existingInstance.phone,
          message: "Instance already connected"
        });
      }
      // Se está em connecting ou error, tentar buscar novo QR
      if (existingInstance.status === "connecting" || existingInstance.status === "error" || existingInstance.status === "disconnected") {
        console.log("[create-instance] Trying to get new QR code...");
        const connectResult = await connectInstance(existingInstance.instance_name);
        if (connectResult.ok && connectResult.data.base64) {
          console.log("[create-instance] Got QR code, updating DB");
          await updateWhatsAppInstance(existingInstance.id, {
            status: "connecting",
            qr_base64: connectResult.data.base64,
            last_error: null
          });
          return jsonResponse({
            instance_name: existingInstance.instance_name,
            qr_base64: connectResult.data.base64,
            status: "connecting"
          });
        }
        // Se não conseguiu QR, retornar estado atual
        console.log("[create-instance] No QR from connect, returning current state");
        return jsonResponse({
          instance_name: existingInstance.instance_name,
          qr_base64: existingInstance.qr_base64,
          status: existingInstance.status,
          last_error: existingInstance.last_error
        });
      }
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
        // Try to connect to existing instance and get QR code
        const connectResult = await connectInstance(instanceName);
        const recoveredQr = connectResult.ok ? (connectResult.data.base64 || null) : null;
        // Save to our database
        const savedInstance = await createWhatsAppInstance(organizationId, instanceName, recoveredQr || undefined);
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
    const savedInstance = await createWhatsAppInstance(organizationId, instanceName, qrBase64 || undefined);
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
