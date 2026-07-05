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
import { generateInstanceName, createInstance, connectInstance, getConnectionState, normalizeConnectionState, extractPhoneFromPayload, fetchInstance, logoutInstance, deleteInstance, listInstanceNames, purgeInstance, restartInstance } from "../_shared/evolution.ts";
import { getWhatsAppInstance, createWhatsAppInstance, deleteWhatsAppInstance } from "../_shared/supabase.ts";
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

    // 1) Sweep only SUFFIXED orphans for this user (ea_<org>_<user>_xxxx) left
    //    by past fallbacks. We deliberately KEEP the canonical instance if it
    //    exists — below we REUSE it (logout + connect for a fresh QR) instead of
    //    delete+recreate. On the shared Evolution server, delete frequently
    //    leaves the name stuck "already in use" (and sometimes a zombie the API
    //    can't remove at all), which is exactly what used to force the ugly
    //    suffixed name. Reusing the canonical keeps the name clean
    //    (ea_<org>_<user>) and guarantees a single instance per number.
    console.log("[create-instance] Sweeping SUFFIXED orphans for user...");
    const allNames = await listInstanceNames();
    const suffixedOrphans = allNames.filter((n) => n.startsWith(`${instanceName}_`));
    console.log("[create-instance] Suffixed orphans to remove:", suffixedOrphans.join(", ") || "(none)");
    for (const name of suffixedOrphans) {
      const gone = await purgeInstance(name);
      if (!gone) {
        console.warn(`[create-instance] Could not confirm removal of ${name} — may linger (reaped later or needs server cleanup)`);
      }
    }

    // 2) Drop our DB row for this user so the insert below doesn't hit the
    //    UNIQUE(org_id, user_id) constraint.
    const existingInstance = await getWhatsAppInstance(organizationId, userId);
    if (existingInstance) {
      await deleteWhatsAppInstance(existingInstance.id);
    }

    // 3) Obtain a QR on the CANONICAL name — always ea_<org>_<user>, no suffix.
    const usedName = instanceName;

    // Pull a fresh QR by reusing the existing instance: logout any stale pairing
    // (so the new scan links cleanly), then connect; nudge a broken instance
    // with a restart and try once more.
    const pullQrViaConnect = async (): Promise<string | null> => {
      await logoutInstance(usedName);
      let r = await connectInstance(usedName);
      if (r.ok && r.data.base64) return r.data.base64;
      await restartInstance(usedName);
      await new Promise((res) => setTimeout(res, 1000));
      r = await connectInstance(usedName);
      return r.ok ? (r.data.base64 ?? null) : null;
    };

    let qrBase64: string | null = null;

    // 3a) Canonical already on Evolution → reuse it directly.
    if (allNames.includes(usedName)) {
      console.log("[create-instance] Canonical exists — reusing via connect:", usedName);
      qrBase64 = await pullQrViaConnect();
    }

    // 3b) Otherwise create it. If the server says the name is reserved, reuse it
    //     via connect rather than minting a suffixed instance.
    if (!qrBase64) {
      console.log("[create-instance] Creating canonical instance:", usedName);
      let createResult = await createInstance(usedName, webhookUrl, EVOLUTION_WEBHOOK_SECRET);
      if (createResult.ok) {
        qrBase64 = createResult.data.qrcode?.base64 || null;
        if (!qrBase64) qrBase64 = await pullQrViaConnect();
      } else if (createResult.error?.includes("already in use")) {
        console.warn("[create-instance] Name reserved — reusing canonical via connect");
        qrBase64 = await pullQrViaConnect();
        if (!qrBase64) {
          // Force-delete + a single recreate attempt on the SAME name.
          console.log("[create-instance] Reuse failed — force-deleting and recreating same name...");
          await logoutInstance(usedName);
          await deleteInstance(usedName);
          await new Promise((res) => setTimeout(res, 1500));
          createResult = await createInstance(usedName, webhookUrl, EVOLUTION_WEBHOOK_SECRET);
          if (createResult.ok) {
            qrBase64 = createResult.data.qrcode?.base64 || (await pullQrViaConnect());
          }
        }
      } else {
        console.error("[create-instance] Evolution API error:", createResult.error);
        return errorResponse(`Failed to create Evolution instance: ${createResult.error}`, 500);
      }
    }

    // 3c) Absolute last resort: the canonical name is a true reserved-zombie the
    //     API won't free (only a server/container restart clears it). Don't
    //     hard-block the SDR — create under a suffixed name this once; the reaper
    //     removes it later once the server recovers. Should now be rare.
    if (!qrBase64) {
      // Before minting yet ANOTHER suffixed instance, try to REUSE a suffixed
      // orphan that survived the sweep. The shared server won't delete zombies,
      // so reusing one (for a fresh QR) instead of creating a new one is what
      // stops the manager from filling with duplicates for the same number.
      // Cap the probe so a user with many survivors doesn't blow the latency.
      const survivors = (await listInstanceNames())
        .filter((n) => n.startsWith(`${instanceName}_`))
        .slice(0, 3);
      let fallbackName: string | null = null;
      let fbQr: string | null = null;
      for (const name of survivors) {
        const c = await connectInstance(name);
        if (c.ok && c.data.base64) {
          fallbackName = name;
          fbQr = c.data.base64;
          console.warn("[create-instance] Reusing surviving suffixed orphan instead of minting a new one:", name);
          break;
        }
      }

      // No reusable survivor → mint a fresh suffixed name (previous behavior).
      if (!fallbackName) {
        fallbackName = generateInstanceName(organizationId, userId, true);
        console.warn("[create-instance] Canonical unusable (reserved-zombie) — last-resort suffixed name:", fallbackName);
        const fb = await createInstance(fallbackName, webhookUrl, EVOLUTION_WEBHOOK_SECRET);
        if (!fb.ok) {
          return errorResponse(`Failed to create Evolution instance: ${fb.error}`, 500);
        }
        fbQr = fb.data.qrcode?.base64 || null;
        if (!fbQr) {
          const c = await connectInstance(fallbackName);
          if (c.ok && c.data.base64) fbQr = c.data.base64;
        }
      }

      const savedFb = await createWhatsAppInstance(organizationId, fallbackName, fbQr || undefined, userId);
      if (!savedFb) {
        return errorResponse("Failed to save instance to database", 500);
      }
      return jsonResponse({ instance_name: fallbackName, qr_base64: fbQr, status: "connecting" });
    }

    // 4) Persist the canonical instance + QR and return.
    console.log("[create-instance] Got QR on canonical:", usedName);
    const savedInstance = await createWhatsAppInstance(organizationId, usedName, qrBase64 || undefined, userId);
    if (!savedInstance) {
      console.error("[create-instance] Failed to save to database");
      return errorResponse("Failed to save instance to database", 500);
    }
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
