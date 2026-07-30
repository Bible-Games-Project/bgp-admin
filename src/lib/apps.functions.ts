import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { commitPreviewWorkflow, githubHeaders } from "@/lib/github.functions";
import { commitAgentDocs } from "@/lib/agent-docs.server";

const ORG = "Bible-Games-Project";

const appInputSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "lowercase, numbers and dashes only"),
  name: z.string().min(1).max(255),
  github_owner: z.string().min(1).max(255),
  github_repo: z.string().min(1).max(255),
  default_ref: z.string().min(1).max(255).default("main"),
  marketing_version: z.string().regex(/^\d+\.\d+$/, "must be in format X.Y (e.g., 1.0, 2.1)").nullable().optional(),
  bundle_id: z.string().max(255).nullable().optional(),
  revenuecat_app_id: z.string().max(255).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  is_active: z.boolean().default(true),
});

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
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
    const { data: row, error } = await context.supabase
      .from("apps")
      .insert(data)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { app: row };
  });

export const createAppWithRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    appInputSchema
      .omit({ github_owner: true, github_repo: true })
      .extend({ repoName: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/) })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { repoName, ...appData } = data;

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

    // ── 5. Set GitHub secrets on the new repo ───────────────────────
    if (cfToken && cfAccount) {
      try {
        // Get the repo's public key for secret encryption
        const pkRes = await fetch(
          `https://api.github.com/repos/${ORG}/${repoName}/actions/secrets/public-key`,
          { headers: githubHeaders() },
        );
        if (pkRes.ok) {
          const pkBody = await pkRes.json();
          // Use libsodium-wrappers (already a dependency) for encryption
          const { default: sodium } = await import("libsodium-wrappers");
          await sodium.ready;

          const encryptSecret = (value: string): string => {
            const binkey = sodium.from_base64(pkBody.key, sodium.base64_variants.ORIGINAL);
            const binSecret = sodium.from_string(value);
            const encBytes = sodium.crypto_box_seal(binSecret, binkey);
            return sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
          };

          const secrets = [
            { name: "CLOUDFLARE_API_TOKEN", value: cfToken },
            { name: "CLOUDFLARE_ACCOUNT_ID", value: cfAccount },
          ];

          for (const s of secrets) {
            const encValue = encryptSecret(s.value);
            const setRes = await fetch(
              `https://api.github.com/repos/${ORG}/${repoName}/actions/secrets/${s.name}`,
              {
                method: "PUT",
                headers: { ...githubHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify({
                  encrypted_value: encValue,
                  key_id: pkBody.key_id,
                }),
              },
            );
            if (!setRes.ok) {
              warnings.push(`Could not set ${s.name} secret.`);
            }
          }
        }
      } catch {
        warnings.push("Could not configure deployment secrets.");
      }
    }

    // ── 6. Insert into Supabase ─────────────────────────────────────
    const { data: row, error } = await context.supabase
      .from("apps")
      .insert({ ...appData, github_owner: ORG, github_repo: repoName, default_ref: defaultBranch })
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
    z.object({ id: z.string().uuid(), patch: appInputSchema.partial() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("apps")
      .update(data.patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { app: row };
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
