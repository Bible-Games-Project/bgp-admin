// RevenueCat webhook receiver.
// Verifies the Authorization header against REVENUECAT_WEBHOOK_SECRET,
// upserts into `purchases` (conflict on transaction_id) and always inserts
// into `purchase_events`. Returns 200 on every outcome except auth failure (401),
// so RevenueCat never retries for app-side issues.
//
// Required env:
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - REVENUECAT_WEBHOOK_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Platform = "ios" | "android";
type ProductType =
  | "consumable"
  | "non_consumable"
  | "subscription"
  | "auto_renewable_subscription";
type Status = "active" | "cancelled" | "refunded" | "expired";
type Environment = "production" | "sandbox";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(body: unknown = { ok: true }): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// Constant-time string compare to avoid timing leaks on the shared secret.
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ab.byteLength; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function mapPlatform(store: string | undefined): Platform | null {
  if (!store) return null;
  const s = String(store).toUpperCase();
  if (s === "APP_STORE" || s === "MAC_APP_STORE") return "ios";
  if (s === "PLAY_STORE" || s === "AMAZON") return "android";
  return null;
}

function mapStatus(type: string): Status {
  switch (type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
      return "active";
    case "CANCELLATION":
      return "cancelled";
    case "EXPIRATION":
      return "expired";
    case "REFUND":
    case "SUBSCRIPTION_PAUSED":
      return "refunded";
    default:
      return "active";
  }
}

function mapProductType(type: string): ProductType {
  if (type === "NON_SUBSCRIPTION_PURCHASE") return "non_consumable";
  if (type === "INITIAL_PURCHASE" || type === "RENEWAL") {
    return "auto_renewable_subscription";
  }
  return "subscription";
}

function mapEnvironment(env: string | undefined): Environment {
  return String(env ?? "PRODUCTION").toUpperCase() === "SANDBOX"
    ? "sandbox"
    : "production";
}

function toIso(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  return new Date(n).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return ok({ ignored: "method" });
  }

  const expected = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  if (!expected) {
    console.error("REVENUECAT_WEBHOOK_SECRET is not configured");
    return unauthorized();
  }

  // RevenueCat sends the configured value as the Authorization header
  // (commonly "Bearer <secret>" but it can be the raw secret).
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.replace(/^Bearer\s+/i, "").trim();
  if (!presented || !safeEqual(presented, expected)) {
    return unauthorized();
  }

  let body: any;
  try {
    body = await req.json();
  } catch (_err) {
    console.warn("Invalid JSON body");
    return ok({ ignored: "invalid_json" });
  }

  const event = body?.event ?? body;
  if (!event || typeof event !== "object") {
    return ok({ ignored: "no_event" });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Supabase env vars missing");
    return ok({ ignored: "server_misconfigured" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const eventType: string = String(event.type ?? "").toUpperCase();
  const platform = mapPlatform(event.store);
  const transactionId: string | undefined =
    event.transaction_id ?? event.original_transaction_id;
  const productId: string | undefined = event.product_id;
  const rcAppId: string | undefined = event.app_id;

  if (!eventType || !platform || !transactionId || !productId) {
    console.warn("Missing required event fields", {
      eventType,
      platform,
      transactionId,
      productId,
    });
    return ok({ ignored: "missing_fields" });
  }

  // Resolve internal app via bundle_id == RevenueCat event.app_id.
  let appId: string | null = null;
  if (rcAppId) {
    const { data: appRow, error: appErr } = await supabase
      .from("apps")
      .select("id")
      .eq("bundle_id", rcAppId)
      .maybeSingle();
    if (appErr) {
      console.error("App lookup failed", appErr);
    }
    appId = appRow?.id ?? null;
  }

  if (!appId) {
    console.warn("No matching app for bundle_id", rcAppId);
    return ok({ ignored: "unknown_app", bundle_id: rcAppId ?? null });
  }

  const purchaseRow = {
    app_id: appId,
    transaction_id: transactionId,
    platform,
    product_id: productId,
    product_type: mapProductType(eventType),
    purchase_date:
      toIso(event.purchased_at_ms) ?? new Date().toISOString(),
    revenue_usd: Number(event.price ?? 0),
    local_currency: event.currency ?? null,
    local_amount:
      event.price_in_purchased_currency != null
        ? Number(event.price_in_purchased_currency)
        : null,
    user_id: event.app_user_id ?? null,
    status: mapStatus(eventType),
    subscription_expires_at: toIso(event.expiration_at_ms),
    environment: mapEnvironment(event.environment),
    raw_payload: body,
  };

  const { data: upserted, error: upsertErr } = await supabase
    .from("purchases")
    .upsert(purchaseRow, { onConflict: "transaction_id" })
    .select("id")
    .single();

  if (upsertErr || !upserted) {
    console.error("Purchase upsert failed", upsertErr);
    return ok({ ignored: "upsert_failed" });
  }

  const { error: evErr } = await supabase.from("purchase_events").insert({
    purchase_id: upserted.id,
    event_type: eventType,
    event_date:
      toIso(event.event_timestamp_ms) ??
      toIso(event.purchased_at_ms) ??
      new Date().toISOString(),
    platform,
    raw_data: body,
  });
  if (evErr) {
    console.error("Event insert failed", evErr);
  }

  return ok({ purchase_id: upserted.id, event_type: eventType });
});
