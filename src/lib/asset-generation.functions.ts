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
    "User-Agent": "bgp-admin-assets",
  };
}

/**
 * Upload asset files to GitHub repository and trigger the asset generation workflow.
 * This function uses the GitHub Contents API to upload files directly, which works
 * in Cloudflare Workers runtime (unlike git clone + simple-git).
 */
export const uploadAndGenerateAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        type: z.enum(["icon", "splash"]),
        imageData: z.string(),
        imageDarkData: z.string().optional(),
        splashBgColor: z.string().optional(),
        splashBgColorDark: z.string().optional(),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    // Verify admin permissions
    await assertAdmin(context.supabase, context.userId);

    // Load app data
    const app = await loadApp(context.supabase, data.appId);

    // Decode base64 image payloads into Uint8Array (sent as base64 strings
    // over RPC to avoid seroval Uint8Array deserialization issues on Workers).
    const base64ToUint8 = (b64: string): Uint8Array => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    };
    const imageData = base64ToUint8(data.imageData);
    const imageDarkData = data.imageDarkData ? base64ToUint8(data.imageDarkData) : undefined;

    // Validate image data
    if (imageData.length > 5 * 1024 * 1024) {
      throw new Error("Image size must be less than 5MB");
    }
    if (imageDarkData && imageDarkData.length > 5 * 1024 * 1024) {
      throw new Error("Dark mode image size must be less than 5MB");
    }


    const owner = app.github_owner;
    const repo = app.github_repo;
    const branch = app.default_ref || "main";

    try {
      // Helper to convert Uint8Array to base64 safely (without stack overflow)
      const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      };

      // Helper to upload a file via GitHub Contents API
      const uploadFile = async (path: string, content: Uint8Array) => {
        // First, try to get the existing file to obtain its SHA (required for updates)
        const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
        const getRes = await fetch(getUrl, { headers: githubHeaders() });
        
        let sha: string | undefined;
        if (getRes.ok) {
          const existing = await getRes.json() as any;
          sha = existing.sha;
        }

        // Convert Uint8Array to base64 safely
        const base64 = uint8ArrayToBase64(content);

        // Upload or update the file
        const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
        const putBody = {
          message: `chore: update ${path} via bgp-admin`,
          content: base64,
          branch,
          ...(sha && { sha }),
        };

        const putRes = await fetch(putUrl, {
          method: "PUT",
          headers: githubHeaders(),
          body: JSON.stringify(putBody),
        });

        if (!putRes.ok) {
          const errorText = await putRes.text();
          throw new Error(`Failed to upload ${path}: ${putRes.status} ${errorText}`);
        }

        // Don't return the full response - just success
        await putRes.json();
        return true;
      };

      // Upload light mode image
      const lightFileName = data.type === "icon" ? "logo.png" : "splash.png";
      console.log(`Uploading ${lightFileName} to mobile-assets/...`);
      await uploadFile(`mobile-assets/${lightFileName}`, imageData);

      // Upload dark mode image if provided
      if (imageDarkData) {
        const darkFileName = data.type === "icon" ? "logo-dark.png" : "splash-dark.png";
        console.log(`Uploading ${darkFileName} to mobile-assets/...`);
        await uploadFile(`mobile-assets/${darkFileName}`, imageDarkData);
      }

      // Upload or update assets configuration file with colors
      const configContent = JSON.stringify({
        iconBackgroundColor: "#ffffff",
        splashBackgroundColor: data.splashBgColor || "#ffffff",
        splashBackgroundColorDark: data.splashBgColorDark || "#000000",
      }, null, 2);
      
      const configBytes = new TextEncoder().encode(configContent);
      console.log("Uploading mobile-assets configuration...");
      await uploadFile("mobile-assets/config.json", configBytes);

      // Trigger the centralized GitHub Action workflow in bgp-admin to generate all asset sizes
      console.log("Triggering centralized asset generation workflow...");
      const dispatchedAt = new Date().toISOString();
      const workflowUrl = `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/workflows/generate-assets.yml/dispatches`;
      const workflowRes = await fetch(workflowUrl, {
        method: "POST",
        headers: githubHeaders(),
        body: JSON.stringify({
          ref: "main",
          inputs: {
            github_owner: owner,
            github_repo: repo,
            branch: branch,
            asset_type: data.type,
            pat: process.env.GITHUB_PAT ?? "",
          },
        }),
      });

      if (!workflowRes.ok) {
        const errorText = await workflowRes.text();
        throw new Error(`Failed to trigger asset generation workflow: ${workflowRes.status} ${errorText}`);
      }

      // Wait for GitHub to register the run (usually takes 2-3s after dispatch)
      await new Promise((r) => setTimeout(r, 4000));

      // Find the workflow run that was just created
      const runsUrl = `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/workflows/generate-assets.yml/runs?per_page=5&created=>=${dispatchedAt.substring(0, 19)}Z`;
      let runId: number | null = null;

      for (let attempt = 0; attempt < 6; attempt++) {
        const runsRes = await fetch(runsUrl, { headers: githubHeaders() });
        if (runsRes.ok) {
          const runsData = await runsRes.json() as any;
          const match = (runsData.workflow_runs ?? []).find(
            (r: any) => new Date(r.created_at) >= new Date(dispatchedAt)
          );
          if (match) {
            runId = match.id;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 3000));
      }

      if (!runId) {
        throw new Error("Asset generation workflow was triggered but could not locate the run. Check GitHub Actions for status.");
      }

      // Poll until the run completes (timeout: 3 minutes)
      const pollTimeoutMs = 3 * 60 * 1000;
      const pollIntervalMs = 6000;
      const pollStart = Date.now();
      let conclusion: string | null = null;

      while (Date.now() - pollStart < pollTimeoutMs) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const runRes = await fetch(
          `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/runs/${runId}`,
          { headers: githubHeaders() }
        );
        if (!runRes.ok) continue;
        const runData = await runRes.json() as any;
        if (runData.status === "completed") {
          conclusion = runData.conclusion;
          break;
        }
      }

      if (!conclusion) {
        throw new Error(`Asset generation workflow timed out after 3 minutes. Check run: https://github.com/Bible-Games-Project/bgp-admin/actions/runs/${runId}`);
      }

      if (conclusion !== "success") {
        // Fetch job logs URL for a helpful error message
        const jobsRes = await fetch(
          `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/runs/${runId}/jobs`,
          { headers: githubHeaders() }
        );
        let failedStep = "";
        if (jobsRes.ok) {
          const jobsData = await jobsRes.json() as any;
          const failedJob = (jobsData.jobs ?? []).find((j: any) => j.conclusion !== "success");
          if (failedJob) {
            const failedStepObj = (failedJob.steps ?? []).find((s: any) => s.conclusion !== "success" && s.conclusion !== null);
            if (failedStepObj) failedStep = ` Failed step: "${failedStepObj.name}".`;
          }
        }
        throw new Error(
          `Asset generation workflow failed (${conclusion}).${failedStep} See: https://github.com/Bible-Games-Project/bgp-admin/actions/runs/${runId}`
        );
      }

      console.log(`Asset generation workflow completed successfully (run ${runId})`);

      const assetType = data.type === "icon" ? "app icon" : "splash screen";
      
      // Cache icon as base64 data URL on apps row for fast list rendering.
      // Only for icons, and only when payload is small enough (<= 500KB raw).
      if (data.type === "icon" && imageData.length <= 500 * 1024) {
        const base64 = data.imageData;
        const dataUrl = `data:image/png;base64,${base64}`;
        const { error: updErr } = await context.supabase
          .from("apps")
          .update({ icon_data_url: dataUrl })
          .eq("id", data.appId);
        if (updErr) {
          console.error("Failed to cache icon_data_url:", updErr.message);
        }
      }

      return {
        success: true,
        commitUrl: `https://github.com/${owner}/${repo}/tree/${branch}/mobile-assets`,
        message: `${assetType.charAt(0).toUpperCase() + assetType.slice(1)} generated and pushed to the repo. Trigger a deploy from the Deploy screen to publish it.`,
      };
    } catch (error) {
      console.error("Asset upload failed:", error);
      throw error instanceof Error ? error : new Error("Asset upload failed");
    }
  });
