import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { commitPreviewWorkflow, findRepoProblem, githubHeaders } from "@/lib/github.functions";
import { setPublishTelegramSecrets, setRepoSecrets, telegramSecrets } from "@/lib/repo-secrets.server";
import { commitAgentDocs } from "@/lib/agent-docs.server";
import { syncAppNameToRepo } from "@/lib/app-name.server";
import { appStoreIds, isOnAnyStore, isWebGame, type AppStoreIds } from "@/lib/app-kind";
import {
  checkAppStore,
  checkGooglePlay,
  checkSteam,
  iconAsDataUrl,
  type StoreCheck,
} from "@/lib/store-lookup.server";
import { slugify } from "@/lib/utils";

// Secret-setting (including the sealed-box crypto) lives in repo-secrets.server.ts.

const ORG = "Bible-Games-Project";

// `slug` is never sent by the client — it is derived from the name server-side.
const appInputSchema = z.object({
  name: z.string().min(1).max(100),
  github_owner: z.string().min(1).max(255),
  github_repo: z.string().min(1).max(255),
  default_ref: z.string().min(1).max(255).default("main"),
  marketing_version: z.string().regex(/^\d+\.\d+$/, "must be in format X.Y (e.g., 1.0, 2.1)").nullable().optional(),
  bundle_id: z.string().max(255).nullable().optional(),
  revenuecat_app_id: z.string().max(255).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  is_active: z.boolean().default(true),
});

// Store IDs of a game that isn't a web game (see app-kind.ts). The Steam App ID
// applies to any game.
const bundleIdFormat = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, "That is not a bundle ID. It looks like com.company.game.");
const packageNameFormat = z
  .string()
  .trim()
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/,
    "That is not a package name. It looks like com.company.game.",
  );
const steamAppIdFormat = z.number().int().positive().max(4294967295);

const storeIdsSchema = z.object({
  android_package_name: packageNameFormat.nullable().optional(),
  steam_app_id: steamAppIdFormat.nullable().optional(),
});

const externalGameSchema = z.object({
  // Left empty, the name is taken from the stores.
  name: z.string().trim().max(100).default(""),
  bundle_id: bundleIdFormat.nullable().optional(),
  android_package_name: packageNameFormat.nullable().optional(),
  steam_app_id: steamAppIdFormat.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  is_active: z.boolean().default(true),
});

/** Two apps on the same store listing would show and edit the same page twice. */
async function findStoreIdConflict(supabase: any, ids: AppStoreIds, excludeId?: string) {
  const { data, error } = await supabase
    .from("apps")
    .select("id, name, github_owner, github_repo, bundle_id, android_package_name, steam_app_id");
  if (error) throw new Error(error.message);
  for (const other of data ?? []) {
    if (other.id === excludeId) continue;
    const taken = appStoreIds(other);
    if (ids.ios && taken.ios === ids.ios) return `${other.name} already uses the bundle ID ${ids.ios}.`;
    if (ids.android && taken.android === ids.android) {
      return `${other.name} already uses the Google Play package name ${ids.android}.`;
    }
    if (ids.steam && taken.steam === ids.steam) return `${other.name} already uses the Steam App ID ${ids.steam}.`;
  }
  return null;
}

/** Checks each ID against its store; throws on an ID the store doesn't know. */
async function checkStoreIds(ids: AppStoreIds): Promise<StoreCheck[]> {
  const checks = await Promise.all([
    ids.ios ? checkAppStore(ids.ios) : null,
    ids.android ? checkGooglePlay(ids.android) : null,
    ids.steam ? checkSteam(ids.steam) : null,
  ]);
  return checks.filter((c): c is StoreCheck => c !== null);
}

/** Drops the fields a patch leaves out, so they don't overwrite anything. */
function definedOnly<T extends Record<string, unknown>>(fields: T) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

function joinWarnings(checks: StoreCheck[]) {
  const warnings = checks.map((c) => c.warning).filter(Boolean);
  return warnings.length ? warnings.join(" ") : undefined;
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

/**
 * Internal key for the app, derived from its name. Collisions get a numeric
 * suffix so the user never has to think about it.
 */
async function uniqueSlug(supabase: any, name: string, excludeId?: string) {
  const base = slugify(name);
  const { data, error } = await supabase.from("apps").select("id, slug").like("slug", `${base}%`);
  if (error) throw new Error(error.message);
  const taken = new Set(
    (data ?? []).filter((r: any) => r.id !== excludeId).map((r: any) => r.slug as string),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export const listApps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("apps")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { apps: data ?? [] };
  });

export const getApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("apps")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("App not found");
    return { app: row };
  });

export const createApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => appInputSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const repoProblem = await findRepoProblem({
      owner: data.github_owner,
      repo: data.github_repo,
      branch: data.default_ref,
    });
    if (repoProblem) throw new Error(repoProblem);
    const slug = await uniqueSlug(context.supabase, data.name);
    const { data: row, error } = await context.supabase
      .from("apps")
      .insert({ ...data, slug })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Linked repos report to the publish chat too — best effort, a secret
    // failing to land never fails the registration itself.
    const tgFailed = await setPublishTelegramSecrets(data.github_repo);
    let warning: string | undefined;
    if (tgFailed.length) {
      warning = `${tgFailed.join(", ")} could not be set on ${data.github_owner}/${data.github_repo}; publish runs there will not notify Telegram until it is.`;
    }

    return { app: row, warning };
  });

/**
 * Registers a game made with another engine (Unity, RPG Maker…), which the
 * console doesn't build: only its store IDs. Each ID is checked against its store
 * first, and the name and icon come from the stores.
 */
export const createExternalGame = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => externalGameSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const ids = appStoreIds({
      bundle_id: data.bundle_id,
      android_package_name: data.android_package_name,
      steam_app_id: data.steam_app_id,
    });
    if (!isOnAnyStore(ids)) {
      throw new Error(
        "Enter at least one store ID: the App Store bundle ID, the Google Play package name or the Steam App ID.",
      );
    }
    const conflict = await findStoreIdConflict(context.supabase, ids);
    if (conflict) throw new Error(conflict);

    const checks = await checkStoreIds(ids);
    const name = data.name || checks.map((c) => c.name).find(Boolean);
    if (!name) {
      throw new Error("The stores did not return a name for this game. Type it in the App name field.");
    }
    let icon: string | null = null;
    for (const check of checks) {
      icon = await iconAsDataUrl(check.iconUrl);
      if (icon) break;
    }

    const { data: row, error } = await context.supabase
      .from("apps")
      .insert({
        name,
        slug: await uniqueSlug(context.supabase, name),
        github_owner: null,
        github_repo: null,
        bundle_id: ids.ios,
        android_package_name: ids.android,
        steam_app_id: ids.steam,
        icon_data_url: icon,
        notes: data.notes ?? null,
        is_active: data.is_active,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    return { app: row, warning: joinWarnings(checks) };
  });

export const createAppWithRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    appInputSchema
      .omit({ github_owner: true, github_repo: true })
      .extend({
        repoName: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[a-zA-Z0-9._-]+$/)
          .optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { repoName: requestedRepo, ...appData } = data;
    const slug = await uniqueSlug(context.supabase, appData.name);
    // Default the repo name to the internal slug so there is nothing extra to type.
    const repoName = requestedRepo || slug;

    // ── 1. Create GitHub repo ──────────────────────────────────────
    const createRes = await fetch(`https://api.github.com/orgs/${ORG}/repos`, {
      method: "POST",
      headers: { ...githubHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: repoName, private: false, auto_init: true }),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      if (createRes.status === 422) {
        throw new Error(`A repository named "${repoName}" already exists.`);
      }
      throw new Error(`Failed to create GitHub repo: ${text.slice(0, 200)}`);
    }

    const repo = await createRes.json();
    const defaultBranch = repo.default_branch as string;

    const warnings: string[] = [];

    // ── 2. Create Cloudflare Pages project ──────────────────────────
    const cfToken = process.env.CLOUDFLARE_API_TOKEN;
    const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
    const tgToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgChat = process.env.TELEGRAM_CHAT_ID;
    if (cfToken && cfAccount) {
      try {
        const cfRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/pages/projects`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name: `bgp-${repoName}`, production_branch: defaultBranch }),
          },
        );
        const cfBody = await cfRes.json();
        if (!cfRes.ok && cfRes.status !== 409) {
          // 409 = already exists, which is fine
          warnings.push(`Cloudflare Pages project could not be created.`);
        }
      } catch {
        warnings.push("Cloudflare Pages project could not be created.");
      }
    }

    // ── 3. Commit preview workflow ──────────────────────────────────
    try {
      await commitPreviewWorkflow({ owner: ORG, repo: repoName, branch: defaultBranch });
    } catch {
      warnings.push("Preview workflow could not be added.");
    }

    // ── 4. Commit agent docs ────────────────────────────────────────
    try {
      await commitAgentDocs({ owner: ORG, repo: repoName, branch: defaultBranch });
    } catch {
      warnings.push("CLAUDE.md/AGENTS.md could not be added.");
    }

    // ── 5. Commit placeholder landing page ───────────────────────────
    // So the first Cloudflare Pages deploy has something to serve
    try {
      const placeholderHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${appData.name} — Bible Games Project</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 2rem;
    }
    .card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 3rem 2.5rem;
      max-width: 560px;
      backdrop-filter: blur(8px);
    }
    h1 { font-size: 1.75rem; font-weight: 600; margin-bottom: 0.5rem; color: #fff; }
    .badge {
      display: inline-block;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      background: rgba(99,102,241,0.25);
      color: #a5b4fc;
      margin-bottom: 1.5rem;
    }
    p { line-height: 1.7; font-size: 0.95rem; color: #b0b0c0; margin-bottom: 1rem; }
    .icon { font-size: 2.5rem; margin-bottom: 1rem; }
    .footer { margin-top: 2rem; font-size: 0.8rem; color: #6b6b80; }
    a { color: #818cf8; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📖</div>
    <h1>${appData.name}</h1>
    <div class="badge">Bible Games Project</div>
    <p>
      This project is ready. Push your code to <strong>main</strong>
      and the preview will update automatically.
    </p>
    <p>
      <a href="https://github.com/${ORG}/${repoName}" target="_blank" rel="noopener">
        github.com/${ORG}/${repoName}
      </a>
    </p>
    <div class="footer">
      Start building &mdash; excellence is not an act, but a habit. 🚀
    </div>
  </div>
</body>
</html>`;

      const packageJson = JSON.stringify({
        name: repoName,
        private: true,
        scripts: {
          build: "mkdir -p dist && cp index.html dist/",
        },
        devDependencies: {
          typescript: "^5.0.0",
          "@capacitor/core": "^8.0.0",
          "@capacitor/cli": "^8.0.0",
          "@capacitor/ios": "^8.0.0",
          "@capacitor/android": "^8.0.0",
        },
      }, null, 2);

      const apiUrl = `https://api.github.com/repos/${ORG}/${repoName}/contents/index.html`;
      const pkgUrl = `https://api.github.com/repos/${ORG}/${repoName}/contents/package.json`;

      const ghHeaders = githubHeaders();

      const putFile = async (url: string, content: string, message: string) => {
        const res = await fetch(url, {
          method: "PUT",
          headers: { ...ghHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            content: Buffer.from(content).toString("base64"),
            branch: defaultBranch,
          }),
        });
        if (!res.ok) throw new Error(`Failed to commit: ${await res.text()}`);
        return res.json();
      };

      // Check if index.html already exists (from auto_init) — if so, skip
      const checkRes = await fetch(
        `${apiUrl}?ref=${encodeURIComponent(defaultBranch)}`,
        { headers: ghHeaders },
      );

      if (!checkRes.ok) {
        // index.html doesn't exist yet — create both files
        await putFile(apiUrl, placeholderHtml, "chore: add placeholder landing page");
        await putFile(pkgUrl, packageJson, "chore: add placeholder package.json for build");
      }
    } catch {
      warnings.push("Placeholder landing page could not be added.");
    }

    // ── 6. Set GitHub secrets on the new repo ───────────────────────
    try {
      const cfSecrets =
        cfToken && cfAccount
          ? [
              { name: "CLOUDFLARE_API_TOKEN", value: cfToken },
              { name: "CLOUDFLARE_ACCOUNT_ID", value: cfAccount },
            ]
          : [];
      const failed = await setRepoSecrets(repoName, [
        ...cfSecrets,
        // Publish notifications arrive on Telegram without a manual step
        ...(tgToken && tgChat ? telegramSecrets() : []),
      ]);
      for (const name of failed) {
        warnings.push(`Could not set ${name} secret.`);
      }
    } catch {
      warnings.push("Could not configure deployment secrets.");
    }

    // ── 6. Insert into Supabase ─────────────────────────────────────
    const { data: row, error } = await context.supabase
      .from("apps")
      .insert({
        ...appData,
        slug,
        github_owner: ORG,
        github_repo: repoName,
        default_ref: defaultBranch,
      })
      .select("*")
      .single();

    if (error) {
      // Rollback: delete the GitHub repo since DB insert failed
      try {
        await fetch(`https://api.github.com/repos/${ORG}/${repoName}`, {
          method: "DELETE",
          headers: githubHeaders(),
        });
      } catch {}
      throw new Error(`${error.message} — the GitHub repo was rolled back automatically.`);
    }

    return {
      app: row,
      warning: warnings.length ? warnings.join(" ") : undefined,
    };
  });

export const updateApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({ id: z.string().uuid(), patch: appInputSchema.merge(storeIdsSchema).partial() })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: current, error: currentError } = await context.supabase
      .from("apps")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (!current) throw new Error("App not found");

    // The console keeps no repo for a game it doesn't build, and a web game ships
    // to Google Play under its bundle ID (Capacitor), so neither takes the other's fields.
    const web = isWebGame(current);
    const { github_owner, github_repo, default_ref, android_package_name, ...common } = data.patch;
    const repoChanges = web ? definedOnly({ github_owner, github_repo, default_ref }) : {};
    const changes = definedOnly({
      ...common,
      ...repoChanges,
      ...(web ? {} : { android_package_name }),
    });

    if (web) {
      const owner = repoChanges.github_owner ?? current.github_owner!;
      const repo = repoChanges.github_repo ?? current.github_repo!;
      const branch = repoChanges.default_ref ?? current.default_ref ?? "main";
      const repoChanged =
        owner !== current.github_owner ||
        repo !== current.github_repo ||
        branch !== (current.default_ref ?? "main");
      if (repoChanged) {
        const repoProblem = await findRepoProblem({ owner, repo, branch });
        if (repoProblem) throw new Error(repoProblem);
      }
    }

    const before = appStoreIds(current);
    const after = appStoreIds({ ...current, ...changes });
    if (!web && !isOnAnyStore(after)) {
      throw new Error(
        "Enter at least one store ID for this game: the App Store bundle ID, the Google Play package name or the Steam App ID.",
      );
    }
    const changedIds: AppStoreIds = {
      ios: after.ios !== before.ios ? after.ios : null,
      android: after.android !== before.android ? after.android : null,
      steam: after.steam !== before.steam ? after.steam : null,
    };
    const conflict = await findStoreIdConflict(context.supabase, changedIds, current.id);
    if (conflict) throw new Error(conflict);
    // A web app gets its bundle ID before the stores have it, so only its Steam
    // App ID is checked against its store.
    const checks = await checkStoreIds(web ? { ios: null, android: null, steam: changedIds.steam } : changedIds);

    const renamed = changes.name != null && changes.name !== current.name;
    const patch = renamed
      ? { ...changes, slug: await uniqueSlug(context.supabase, changes.name!, data.id) }
      : changes;

    const { data: row, error } = await context.supabase
      .from("apps")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Keep the name players see on their device in sync with the one stored here.
    // A game that isn't a web game gets that name from its own project, not from here.
    const warnings = [joinWarnings(checks)].filter(Boolean) as string[];
    let nameSync: { committed: number; repo: string } | undefined;
    if (renamed && isWebGame(row)) {
      const repo = `${row.github_owner}/${row.github_repo}`;
      const { updated, failed } = await syncAppNameToRepo({
        owner: row.github_owner,
        repo: row.github_repo,
        ref: row.default_ref || "main",
        appName: row.name,
      });
      nameSync = { committed: updated.length, repo };
      if (failed.length) {
        warnings.push(`The new name could not be written to ${failed.join(", ")} in ${repo}.`);
      }
    }

    return { app: row, warning: warnings.length ? warnings.join(" ") : undefined, nameSync };
  });

export const deleteApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("apps").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
