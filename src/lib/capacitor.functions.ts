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
    "User-Agent": "bgp-admin-capacitor",
  };
}

export const checkCapacitorStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ appId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const branch = app.default_ref || "main";
    const base = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents`;

    const checkPath = async (path: string) => {
      const res = await fetch(`${base}/${path}?ref=${encodeURIComponent(branch)}`, {
        headers: githubHeaders(),
      });
      return res.ok;
    };

    const [hasTsConfig, hasJsonConfig, hasIos, hasAndroid] = await Promise.all([
      checkPath("capacitor.config.ts"),
      checkPath("capacitor.config.json"),
      checkPath("ios"),
      checkPath("android"),
    ]);

    return {
      hasConfig: hasTsConfig || hasJsonConfig,
      hasIos,
      hasAndroid,
    };
  });

export const setupCapacitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ appId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);

    if (!app.bundle_id) {
      throw new Error(
        "Bundle ID is required. Set it in the General tab before running Capacitor setup.",
      );
    }

    const branch = app.default_ref || "main";
    const dispatchedAt = new Date().toISOString();

    const workflowUrl = `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/workflows/setup-capacitor.yml/dispatches`;
    const workflowRes = await fetch(workflowUrl, {
      method: "POST",
      headers: { ...githubHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          github_owner: app.github_owner,
          github_repo: app.github_repo,
          branch,
          bundle_id: app.bundle_id,
          app_name: app.name,
          pat: process.env.GITHUB_PAT ?? "",
        },
      }),
    });

    if (!workflowRes.ok) {
      const text = await workflowRes.text();
      throw new Error(
        `Failed to trigger Capacitor setup workflow: ${workflowRes.status} ${text}`,
      );
    }

    // Wait for GitHub to register the run
    await new Promise((r) => setTimeout(r, 4000));

    // Locate the workflow run that was just dispatched
    const runsUrl = `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/workflows/setup-capacitor.yml/runs?per_page=5&created=>=${dispatchedAt.substring(0, 19)}Z`;
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
      throw new Error(
        "Capacitor setup workflow was triggered but could not locate the run. Check GitHub Actions for status.",
      );
    }

    // Poll until complete (10-minute timeout)
    const pollTimeoutMs = 10 * 60 * 1000;
    const pollIntervalMs = 8000;
    const pollStart = Date.now();
    let conclusion: string | null = null;

    while (Date.now() - pollStart < pollTimeoutMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
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

    if (!conclusion) {
      throw new Error(
        `Capacitor setup workflow timed out after 10 minutes. Check run: https://github.com/Bible-Games-Project/bgp-admin/actions/runs/${runId}`,
      );
    }

    if (conclusion !== "success") {
      const jobsRes = await fetch(
        `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/runs/${runId}/jobs`,
        { headers: githubHeaders() },
      );
      let failedStep = "";
      if (jobsRes.ok) {
        const jobsData = (await jobsRes.json()) as any;
        const failedJob = (jobsData.jobs ?? []).find((j: any) => j.conclusion !== "success");
        if (failedJob) {
          const failedStepObj = (failedJob.steps ?? []).find(
            (s: any) => s.conclusion !== "success" && s.conclusion !== null,
          );
          if (failedStepObj) failedStep = ` Failed step: "${failedStepObj.name}".`;
        }
      }
      throw new Error(
        `Capacitor setup workflow failed (${conclusion}).${failedStep} See: https://github.com/Bible-Games-Project/bgp-admin/actions/runs/${runId}`,
      );
    }

    return {
      success: true,
      runUrl: `https://github.com/Bible-Games-Project/bgp-admin/actions/runs/${runId}`,
      message:
        "Capacitor set up successfully. The ios/ and android/ native projects have been added to the repository.",
    };
  });
