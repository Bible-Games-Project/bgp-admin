import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { commitPreviewWorkflow, githubHeaders } from "@/lib/github.functions";
import { commitAgentDocs } from "@/lib/agent-docs.server";
import sodium from "libsodium-wrappers";
import nacl from "tweetnacl";
import { blake2b } from "blakejs";

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
    if (cfToken && cfAccount) {
      try {
        // Get the repo's public key for secret encryption
        const pkRes = await fetch(
          `https://api.github.com/repos/${ORG}/${repoName}/actions/secrets/public-key`,
          { headers: githubHeaders() },
        );
        if (pkRes.ok) {
          const pkBody = await pkRes.json();

          // Libsodium-compatible crypto_box_seal using tweetnacl (pure JS, no WASM)
          // Format: ephemeral_pk (32) || ciphertext
          // Nonce is derived as HASH(ephemeral_pk || recipient_pk)[0:24]
          const encryptSecret = (value: string): string => {
            const recipientKey = new Uint8Array(
              atob(pkBody.key).split("").map((c) => c.charCodeAt(0)),
            );
            const messageBytes = new TextEncoder().encode(value);
            const ephemeral = nacl.box.keyPair();

            // Derive nonce: first 24 bytes of BLAKE2b(ephemeral_pk || recipient_pk)
            // libsodium's crypto_box_seal uses BLAKE2b (via crypto_generichash)
            const combinedKeys = new Uint8Array(64);
            combinedKeys.set(ephemeral.publicKey, 0);
            combinedKeys.set(recipientKey, 32);
            const nonce = blake2b(combinedKeys, undefined, nacl.box.nonceLength);

            const ciphertext = nacl.box(
              messageBytes,
              nonce,
              recipientKey,
              ephemeral.secretKey,
            );

            // Sealed box format: ephemeral_pk (32) || ciphertext
            const combined = new Uint8Array(32 + ciphertext.length);
            combined.set(ephemeral.publicKey, 0);
            combined.set(ciphertext, 32);
            return btoa(String.fromCharCode(...combined));
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
