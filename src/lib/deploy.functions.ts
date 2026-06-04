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
  const { data, error } = await supabase
    .from("apps")
    .select("*")
    .eq("id", appId)
    .maybeSingle();
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
    "User-Agent": "bgp-deploy-console",
  };
}

export const getRepoMarketingVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        ref: z.string().min(1).max(255).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const ref = data.ref ?? app.default_ref ?? "main";

    // Read version from package.json — this is the canonical source of truth
    // updated via pre-deploy commit when the user triggers a deploy with a new version.
    const url = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents/package.json?ref=${encodeURIComponent(ref)}`;
    const res = await fetch(url, { headers: githubHeaders() });
    if (!res.ok) return { version: null as string | null };
    try {
      const json: any = await res.json();
      const content = Buffer.from(json.content, "base64").toString("utf-8");
      const pkg = JSON.parse(content);
      if (typeof pkg.version === "string") {
        return { version: pkg.version };
      }
    } catch {
      // fall through
    }
    return { version: null as string | null };
  });

export const getCommitsAheadOfLatestTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        ref: z.string().min(1).max(255).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const ref = data.ref ?? app.default_ref ?? "main";
    const repo = `${app.github_owner}/${app.github_repo}`;

    const tagsRes = await fetch(
      `https://api.github.com/repos/${repo}/tags?per_page=1`,
      { headers: githubHeaders() },
    );
    if (!tagsRes.ok) {
      return { tag: null as string | null, ahead: 0, behind: 0, compareUrl: null as string | null, error: `GitHub API ${tagsRes.status}` };
    }
    const tags: any = await tagsRes.json();
    if (!Array.isArray(tags) || tags.length === 0) {
      return { tag: null, ahead: 0, behind: 0, compareUrl: null, error: null as string | null };
    }
    const tag = tags[0].name as string;

    const cmpRes = await fetch(
      `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(tag)}...${encodeURIComponent(ref)}`,
      { headers: githubHeaders() },
    );
    if (!cmpRes.ok) {
      return { tag, ahead: 0, behind: 0, compareUrl: null, error: `GitHub API ${cmpRes.status}` };
    }
    const cmp: any = await cmpRes.json();
    return {
      tag,
      ahead: cmp.ahead_by ?? 0,
      behind: cmp.behind_by ?? 0,
      compareUrl: `https://github.com/${repo}/compare/${tag}...${ref}` as string | null,
      error: null as string | null,
    };
  });

export const isCurrentUserAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    return { isAdmin: !!data };
  });

export const listWorkflows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const url = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/actions/workflows?per_page=100`;
    const res = await fetch(url, { headers: githubHeaders() });
    if (!res.ok) {
      const text = await res.text();
      return { workflows: [], error: `GitHub API ${res.status}: ${text.slice(0, 200)}` };
    }
    const json: any = await res.json();
    return {
      workflows: (json.workflows ?? [])
        .filter((w: any) => w.state === "active")
        .map((w: any) => ({
          id: w.id,
          name: w.name,
          path: w.path,
          file: w.path.split("/").pop() as string,
        })),
      error: null as string | null,
    };
  });

export const listRepoRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const url = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/actions/runs?per_page=15`;
    const res = await fetch(url, { headers: githubHeaders() });
    if (!res.ok) {
      const text = await res.text();
      return { runs: [], error: `GitHub API ${res.status}: ${text.slice(0, 200)}` };
    }
    const json: any = await res.json();
    return {
      runs: (json.workflow_runs ?? []).map((r: any) => ({
        id: r.id,
        status: r.status,
        conclusion: r.conclusion,
        event: r.event,
        actor: r.actor?.login ?? null,
        head_branch: r.head_branch,
        created_at: r.created_at,
        html_url: r.html_url,
        run_number: r.run_number,
        workflow_name: r.name ?? null,
      })),
      error: null as string | null,
    };
  });

export const triggerDeploy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        workflowFile: z.string().min(1).max(255),
        ref: z.string().min(1).max(255).optional(),
        inputs: z.record(z.any()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    if (!app.is_active) throw new Error("App is disabled");
    const ref = data.ref ?? app.default_ref ?? "main";

    // If marketing-version is provided, update package.json in the repo before deploy
    const marketingVersion = data.inputs?.["marketing-version"];
    if (marketingVersion && typeof marketingVersion === "string") {
      try {
        // Fetch current package.json
        const pkgUrl = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents/package.json?ref=${encodeURIComponent(ref)}`;
        const pkgRes = await fetch(pkgUrl, { headers: githubHeaders() });
        if (!pkgRes.ok) {
          throw new Error(`Failed to fetch package.json: ${pkgRes.status}`);
        }
        const pkgJson: any = await pkgRes.json();
        const pkgContent = Buffer.from(pkgJson.content, "base64").toString("utf-8");
        const pkg = JSON.parse(pkgContent);
        
        // Update version field
        const oldVersion = pkg.version;
        pkg.version = marketingVersion;
        
        // Commit if changed
        if (oldVersion !== marketingVersion) {
          const newContent = JSON.stringify(pkg, null, 2) + "\n";
          const base64Content = Buffer.from(newContent).toString("base64");
          const commitRes = await fetch(pkgUrl.split("?")[0], {
            method: "PUT",
            headers: githubHeaders(),
            body: JSON.stringify({
              message: `chore: bump version to ${marketingVersion}`,
              content: base64Content,
              branch: ref,
              sha: pkgJson.sha,
            }),
          });
          if (!commitRes.ok) {
            const errText = await commitRes.text();
            throw new Error(`Failed to commit package.json: ${commitRes.status} ${errText.slice(0, 200)}`);
          }
          console.log(`Updated package.json version: ${oldVersion} → ${marketingVersion}`);
        }
      } catch (err) {
        console.error("Failed to update package.json version:", err);
        // Don't throw — allow deploy to proceed even if version update fails
      }
    }

    const url = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/actions/workflows/${encodeURIComponent(
      data.workflowFile,
    )}/dispatches`;
    
    const body: any = { ref };
    if (data.inputs && Object.keys(data.inputs).length > 0) {
      body.inputs = data.inputs;
    }
    
    const res = await fetch(url, {
      method: "POST",
      headers: { ...githubHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub dispatch failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return { ok: true, ref, workflowFile: data.workflowFile };
  });
