/**
 * Edge Function: evolution-disconnect
 *
 * Desconecta a instância WhatsApp da organização:
 * 1. Faz logout na Evolution API
 * 2. Deleta o registro do banco
 *
 * Requer autenticação (qualquer membro da organização).
 *
 * POST /evolution-disconnect
 * Response: { success: true }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAuthContext } from "../_shared/auth.ts";
import { logoutInstance } from "../_shared/evolution.ts";
import { getWhatsAppInstance, deleteWhatsAppInstance } from "../_shared/supabase.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const authResult = await getAuthContext(req);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { organizationId, userId } = authResult.context;

  try {
    const instance = await getWhatsAppInstance(organizationId, userId);
    if (!instance) {
      return jsonResponse({ success: true, message: "No instance to disconnect" });
    }

    // Logout from Evolution API (best-effort)
    console.log("[disconnect] Logging out instance:", instance.instance_name);
    try {
      await logoutInstance(instance.instance_name);
      console.log("[disconnect] Logout OK");
    } catch (err) {
      console.warn("[disconnect] Logout failed (continuing with DB delete):", err);
    }

    // Delete from DB
    await deleteWhatsAppInstance(instance.id);
    console.log("[disconnect] DB record deleted");

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("[disconnect] Exception:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(message, 500);
  }
});
