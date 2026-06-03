import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const platformSchema = z.enum(["ios", "android"]).nullable().optional();
const datePresetSchema = z.enum(["7d", "30d", "90d", "all"]).default("30d");

const filtersSchema = z.object({
  appId: z.string().uuid().nullable().optional(),
  platform: platformSchema,
  preset: datePresetSchema,
});

type Filters = z.infer<typeof filtersSchema>;

function rangeFromPreset(preset: Filters["preset"]) {
  if (preset === "all") return { from: null as string | null, to: null as string | null };
  const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
  const to = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

function rpcArgs(f: Filters) {
  const { from, to } = rangeFromPreset(f.preset);
  return {
    p_app: f.appId ?? null,
    p_platform: f.platform ?? null,
    p_from: from,
    p_to: to,
  };
}

export const getRevenueStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => filtersSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await (context.supabase as any).rpc(
      "revenue_stats",
      rpcArgs(data),
    );
    if (error) throw new Error(error.message);
    const r = Array.isArray(row) ? row[0] : row;
    const totalUsd = Number(r?.total_usd ?? 0);
    const monthUsd = Number(r?.month_usd ?? 0);
    const prevMonthUsd = Number(r?.prev_month_usd ?? 0);
    const activeSubs = Number(r?.active_subs ?? 0);
    const mrrUsd = Number(r?.mrr_usd ?? 0);
    const monthChangePct =
      prevMonthUsd > 0 ? ((monthUsd - prevMonthUsd) / prevMonthUsd) * 100 : null;
    return { totalUsd, monthUsd, prevMonthUsd, monthChangePct, activeSubs, mrrUsd };
  });

export const getRevenueTimeseries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => filtersSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await (context.supabase as any).rpc(
      "revenue_timeseries",
      rpcArgs(data),
    );
    if (error) throw new Error(error.message);
    return {
      points: (rows ?? []).map((r: any) => ({
        day: r.day as string,
        revenueUsd: Number(r.revenue_usd ?? 0),
      })),
    };
  });

export const getRevenueByPlatform = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => filtersSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { from, to } = rangeFromPreset(data.preset);
    const { data: rows, error } = await (context.supabase as any).rpc(
      "revenue_by_platform",
      { p_app: data.appId ?? null, p_from: from, p_to: to },
    );
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []).map((r: any) => ({
        platform: r.platform as "ios" | "android",
        revenueUsd: Number(r.revenue_usd ?? 0),
      })),
    };
  });

export const getRevenueByApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => filtersSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { from, to } = rangeFromPreset(data.preset);
    const { data: rows, error } = await (context.supabase as any).rpc(
      "revenue_by_app",
      { p_platform: data.platform ?? null, p_from: from, p_to: to },
    );
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []).map((r: any) => ({
        appId: r.app_id as string,
        appName: r.app_name as string,
        revenueUsd: Number(r.revenue_usd ?? 0),
      })),
    };
  });

export const getTopProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    filtersSchema.extend({ limit: z.number().int().min(1).max(50).default(10) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await (context.supabase as any).rpc("top_products", {
      ...rpcArgs(data),
      p_limit: data.limit,
    });
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []).map((r: any) => ({
        productId: r.product_id as string,
        count: Number(r.count ?? 0),
        revenueUsd: Number(r.revenue_usd ?? 0),
      })),
    };
  });

export const getRecentPurchases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    filtersSchema
      .extend({
        limit: z.number().int().min(1).max(100).default(10),
        offset: z.number().int().min(0).default(0),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { from, to } = rangeFromPreset(data.preset);
    let q = (context.supabase as any)
      .from("purchases")
      .select(
        "id, app_id, transaction_id, platform, product_id, product_type, purchase_date, revenue_usd, local_currency, local_amount, user_id, status, subscription_expires_at, environment, raw_payload, apps(name)",
        { count: "exact" },
      )
      .order("purchase_date", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (data.appId) q = q.eq("app_id", data.appId);
    if (data.platform) q = q.eq("platform", data.platform);
    if (from) q = q.gte("purchase_date", from);
    if (to) q = q.lt("purchase_date", to);
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []).map((r: any) => ({
        id: r.id,
        appId: r.app_id,
        appName: r.apps?.name ?? null,
        transactionId: r.transaction_id,
        platform: r.platform,
        productId: r.product_id,
        productType: r.product_type,
        purchaseDate: r.purchase_date,
        revenueUsd: Number(r.revenue_usd ?? 0),
        localCurrency: r.local_currency,
        localAmount: r.local_amount != null ? Number(r.local_amount) : null,
        userId: r.user_id,
        status: r.status,
        subscriptionExpiresAt: r.subscription_expires_at,
        environment: r.environment,
        rawPayload: r.raw_payload,
      })),
      total: count ?? 0,
    };
  });
