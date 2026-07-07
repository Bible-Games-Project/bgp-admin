import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

async function loadApp(supabase: any, appId: string) {
  const { data, error } = await supabase.from("apps").select("*").eq("id", appId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("App not found");
  return data;
}

function githubHeaders() {
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error("GITHUB_PAT not configured");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "bgp-admin-addons",
  };
}

const addonSchema = z.enum(["iap", "rewarded-ads"]);
export type AddonId = z.infer<typeof addonSchema>;

const iapConfigSchema = z.object({
  rcApiKeyIos: z.string().startsWith("appl_", "iOS key must start with appl_"),
  rcApiKeyAndroid: z.string().startsWith("goog_", "Android key must start with goog_"),
});

const rewardedAdsConfigSchema = z.object({
  admobAppIdIos: z
    .string()
    .regex(/^ca-app-pub-\d+~\d+$/, "iOS App ID must look like ca-app-pub-XXXX~YYYY"),
  admobAppIdAndroid: z
    .string()
    .regex(/^ca-app-pub-\d+~\d+$/, "Android App ID must look like ca-app-pub-XXXX~YYYY"),
  adUnitIdIos: z
    .string()
    .regex(/^ca-app-pub-\d+\/\d+$/, "iOS ad unit ID must look like ca-app-pub-XXXX/YYYY"),
  adUnitIdAndroid: z
    .string()
    .regex(/^ca-app-pub-\d+\/\d+$/, "Android ad unit ID must look like ca-app-pub-XXXX/YYYY"),
});

const ADDON_PACKAGES: Record<AddonId, string> = {
  iap: "@revenuecat/purchases-capacitor",
  "rewarded-ads": "@capacitor-community/admob",
};

async function fetchRepoFile(app: any, path: string): Promise<string | null> {
  const branch = app.default_ref || "main";
  const url = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) return null;
  const json = (await res.json()) as any;
  if (!json.content) return null;
  return Buffer.from(json.content, "base64").toString("utf-8");
}

export const checkAddonStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ appId: z.string().uuid(), addon: addonSchema }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);

    const pkgJson = await fetchRepoFile(app, "package.json");
    const pkg = pkgJson ? JSON.parse(pkgJson) : {};
    const packageInstalled = Boolean(
      pkg.dependencies?.[ADDON_PACKAGES[data.addon]] ||
      pkg.devDependencies?.[ADDON_PACKAGES[data.addon]],
    );

    if (data.addon === "iap") {
      const [hook, paywall] = await Promise.all([
        fetchRepoFile(app, "src/hooks/useIAP.ts"),
        fetchRepoFile(app, "src/components/Paywall.tsx"),
      ]);
      const keysConfigured = Boolean(
        hook &&
        !hook.includes("__RC_API_KEY") &&
        hook.includes('"appl_') &&
        hook.includes('"goog_'),
      );
      return {
        packageInstalled,
        files: [
          { label: "src/hooks/useIAP.ts", ok: Boolean(hook) },
          { label: "src/components/Paywall.tsx", ok: Boolean(paywall) },
          { label: "RevenueCat API keys filled in", ok: keysConfigured },
        ],
        installed: packageInstalled && Boolean(hook) && Boolean(paywall) && keysConfigured,
      };
    }

    const [hook, manifest, plist] = await Promise.all([
      fetchRepoFile(app, "src/hooks/useRewardedAd.ts"),
      fetchRepoFile(app, "android/app/src/main/AndroidManifest.xml"),
      fetchRepoFile(app, "ios/App/App/Info.plist"),
    ]);
    const keysConfigured = Boolean(hook && !hook.includes("__ADMOB_"));
    const androidPatched = Boolean(
      manifest && manifest.includes("com.google.android.gms.ads.APPLICATION_ID"),
    );
    const iosPatched = Boolean(plist && plist.includes("GADApplicationIdentifier"));
    return {
      packageInstalled,
      files: [
        { label: "src/hooks/useRewardedAd.ts", ok: Boolean(hook) },
        { label: "Ad unit IDs filled in", ok: keysConfigured },
        { label: "AndroidManifest.xml AdMob App ID", ok: androidPatched },
        { label: "Info.plist AdMob App ID", ok: iosPatched },
      ],
      installed:
        packageInstalled && Boolean(hook) && keysConfigured && androidPatched && iosPatched,
    };
  });

export const setupAddon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => {
    const base = z
      .object({
        appId: z.string().uuid(),
        addon: addonSchema,
        config: z.record(z.string(), z.string()),
      })
      .parse(i);
    const config =
      base.addon === "iap"
        ? iapConfigSchema.parse(base.config)
        : rewardedAdsConfigSchema.parse(base.config);
    return { ...base, config };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const branch = app.default_ref || "main";
    const dispatchedAt = new Date().toISOString();

    const workflowUrl = `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/workflows/setup-addon.yml/dispatches`;
    const workflowRes = await fetch(workflowUrl, {
      method: "POST",
      headers: { ...githubHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          github_owner: app.github_owner,
          github_repo: app.github_repo,
          branch,
          addon: data.addon,
          config_json: JSON.stringify(data.config),
          pat: process.env.GITHUB_PAT ?? "",
        },
      }),
    });

    if (!workflowRes.ok) {
      const text = await workflowRes.text();
      throw new Error(`Failed to trigger addon setup workflow: ${workflowRes.status} ${text}`);
    }

    await new Promise((r) => setTimeout(r, 4000));

    const runsUrl = `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/workflows/setup-addon.yml/runs?per_page=5&created=>=${dispatchedAt.substring(0, 19)}Z`;
    let runId: number | null = null;

    for (let attempt = 0; attempt < 6; attempt++) {
      const runsRes = await fetch(runsUrl, { headers: githubHeaders() });
      if (runsRes.ok) {
        const runsData = (await runsRes.json()) as any;
        const match = (runsData.workflow_runs ?? []).find(
          (r: any) => new Date(r.created_at) >= new Date(dispatchedAt),
        );
        if (match) {
          runId = match.id;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    if (!runId) {
      throw new Error("Addon setup workflow triggered but run not found. Check GitHub Actions.");
    }

    const pollTimeoutMs = 8 * 60 * 1000;
    const pollStart = Date.now();
    let conclusion: string | null = null;

    while (Date.now() - pollStart < pollTimeoutMs) {
      await new Promise((r) => setTimeout(r, 8000));
      const runRes = await fetch(
        `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/runs/${runId}`,
        { headers: githubHeaders() },
      );
      if (!runRes.ok) continue;
      const runData = (await runRes.json()) as any;
      if (runData.status === "completed") {
        conclusion = runData.conclusion;
        break;
      }
    }

    const runUrl = `https://github.com/Bible-Games-Project/bgp-admin/actions/runs/${runId}`;
    if (!conclusion) {
      throw new Error(`Addon setup workflow timed out. Check: ${runUrl}`);
    }
    if (conclusion !== "success") {
      throw new Error(`Addon setup workflow failed (${conclusion}). See: ${runUrl}`);
    }

    return {
      success: true,
      runUrl,
      message: `${data.addon === "iap" ? "In-App Purchases" : "Rewarded Ads"} addon installed in ${app.github_owner}/${app.github_repo}.`,
    };
  });
