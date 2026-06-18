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
import { generateInstanceName, createInstance, connectInstance, getConnectionState, normalizeConnectionState, extractPhoneFromPayload, fetchInstance, logoutInstance, deleteInstance, listInstanceNames } from "../_shared/evolution.ts";
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
    // Canonical, suffix-free name for this user. We ALWAYS reuse this exact
    // name so a user never accumulates multiple Evolution instances.
    const instanceName = generateInstanceName(organizationId, userId);
    const webhookUrl = `${SUPABASE_URL}/functions/v1/evolution-webhook`;

    // 1) Sweep EVERY Evolution instance belonging to this user — the canonical
    //    name AND any orphaned suffixed names (`ea_org_user_5qqp`) left behind
    //    by past "already in use" retries. Leaving an old instance alive paired
    //    to the same phone is what caused the "Connection Closed" session
    //    conflict (two Baileys sockets fighting over one number — V4 Amaral,
    //    jun/2026). Best-effort: logout then delete each.
    console.log("[create-instance] Sweeping existing Evolution instances for user...");
    const allNames = await listInstanceNames();
    const mine = allNames.filter((n) => n === instanceName || n.startsWith(`${instanceName}_`));
    console.log("[create-instance] Found", mine.length, "instance(s) to remove:", mine.join(", ") || "(none)");
    for (const name of mine) {
      await logoutInstance(name);
      await deleteInstance(name);
    }

    // 2) Drop our DB row for this user so the insert below doesn't hit the
    //    UNIQUE(org_id, user_id) constraint.
    const existingInstance = await getWhatsAppInstance(organizationId, userId);
    if (existingInstance) {
      await deleteWhatsAppInstance(existingInstance.id);
    }

    // 3) Create the instance. Prefer the canonical name; the name actually used
    //    is tracked in `usedName` (may differ if we fall back below).
    let usedName = instanceName;
    console.log("[create-instance] Calling Evolution API to create:", usedName);
    let createResult = await createInstance(usedName, webhookUrl, EVOLUTION_WEBHOOK_SECRET);

    // If the sweep missed a stale instance (race, or version-specific list
    // shape), force-remove THIS exact name and retry once with the SAME name.
    if (!createResult.ok && createResult.error?.includes("already in use")) {
      console.log("[create-instance] Still in use after sweep — force-deleting and retrying same name...");
      await logoutInstance(usedName);
      await deleteInstance(usedName);
      await new Promise((r) => setTimeout(r, 1500));
      createResult = await createInstance(usedName, webhookUrl, EVOLUTION_WEBHOOK_SECRET);
    }

    // Last resort: the Evolution server is holding the canonical name reserved
    // even though our delete reports done (known on shared Evolution servers —
    // the name lingers in its DB/cache after the manager "delete"). Rather than
    // BLOCK the user, connect under a fresh unique name. The sweep above already
    // logged out the user's old instances, so the freshly-scanned one becomes
    // the only paired device — no "Connection Closed" conflict. The stuck
    // canonical name is a harmless reserved entry until the Evolution server is
    // cleaned/restarted.
    if (!createResult.ok && createResult.error?.includes("already in use")) {
      usedName = generateInstanceName(organizationId, userId, true);
      console.warn("[create-instance] Canonical name stuck on Evolution — falling back to fresh name:", usedName);
      createResult = await createInstance(usedName, webhookUrl, EVOLUTION_WEBHOOK_SECRET);
    }

    if (!createResult.ok) {
      console.error("[create-instance] Evolution API error:", createResult.error);
      return errorResponse(`Failed to create Evolution instance: ${createResult.error}`, 500);
    }
    console.log("[create-instance] Evolution API success as:", usedName);
    // Extrair QR code se disponível
    const qrBase64 = createResult.data.qrcode?.base64 || null;
    console.log("[create-instance] QR from create:", qrBase64 ? "yes" : "no");
    // Salvar no banco
    console.log("[create-instance] Saving to database...");
    const savedInstance = await createWhatsAppInstance(organizationId, usedName, qrBase64 || undefined, userId);
    if (!savedInstance) {
      console.error("[create-instance] Failed to save to database");
      return errorResponse("Failed to save instance to database", 500);
    }
    console.log("[create-instance] Saved to DB, id:", savedInstance.id);
    // Se não veio QR na criação, tentar buscar via connect
    if (!qrBase64) {
      console.log("[create-instance] No QR from create, trying connect...");
      const connectResult = await connectInstance(usedName);
      if (connectResult.ok && connectResult.data.base64) {
        console.log("[create-instance] Got QR from connect");
        await updateWhatsAppInstance(savedInstance.id, {
          qr_base64: connectResult.data.base64
        });
        return jsonResponse({
          instance_name: usedName,
          qr_base64: connectResult.data.base64,
          status: "connecting"
        });
      }
      console.log("[create-instance] No QR from connect either");
    }
    console.log("[create-instance] Returning response");
    return jsonResponse({
      instance_name: usedName,
      qr_base64: qrBase64,
      status: "connecting"
    });
  } catch (error) {
    console.error("[create-instance] Exception:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(message, 500);
  }
});
