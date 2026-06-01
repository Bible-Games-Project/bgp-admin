import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const platformSchema = z.enum(["ios", "android"]);
type Platform = z.infer<typeof platformSchema>;

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

function workflowFileFor(app: any, platform: Platform) {
  return platform === "ios" ? app.ios_workflow_file : app.android_workflow_file;
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

export const listWorkflowRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ appId: z.string().uuid(), platform: platformSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const file = workflowFileFor(app, data.platform);
    const url = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/actions/workflows/${file}/runs?per_page=10`;
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
        platform: platformSchema,
        ref: z.string().min(1).max(255).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    if (!app.is_active) throw new Error("App is disabled");
    const file = workflowFileFor(app, data.platform);
    const ref = data.ref ?? app.default_ref ?? "main";
    const url = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/actions/workflows/${file}/dispatches`;
    const res = await fetch(url, {
      method: "POST",
      headers: { ...githubHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub dispatch failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return { ok: true, ref, platform: data.platform };
  });
