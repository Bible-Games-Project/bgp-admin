import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GITHUB_OWNER = "Bible-Games-Project";
const GITHUB_REPO = "shared-workflows";
const WORKFLOW_FILE = "deploy.yml";
const DEFAULT_REF = "main";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
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

export const listWorkflowRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=10`;
    const res = await fetch(url, { headers: githubHeaders() });
    if (!res.ok) {
      const text = await res.text();
      return { runs: [], error: `GitHub API ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json();
    return {
      runs: (data.workflow_runs ?? []).map((r: any) => ({
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
      .object({ ref: z.string().min(1).max(255).optional() })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
    const res = await fetch(url, {
      method: "POST",
      headers: { ...githubHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: data.ref ?? DEFAULT_REF }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub dispatch failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return { ok: true, ref: data.ref ?? DEFAULT_REF };
  });

export const workflowMeta = () => ({
  owner: GITHUB_OWNER,
  repo: GITHUB_REPO,
  file: WORKFLOW_FILE,
  defaultRef: DEFAULT_REF,
});
