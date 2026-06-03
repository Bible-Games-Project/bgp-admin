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
    .select("github_owner, github_repo, default_ref")
    .eq("id", appId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("App not found");
  return data;
}

function getGithubPAT() {
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error("GITHUB_PAT not configured");
  return token;
}

async function fetchGithubFileAsDataUrl(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  token: string
): Promise<{ dataUrl: string; sha: string } | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(
    path
  )}?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bgp-admin",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }
  const json: any = await res.json();
  if (!json || json.type !== "file" || typeof json.content !== "string") {
    return null;
  }
  // GitHub returns base64 with line breaks
  const base64 = json.content.replace(/\n/g, "");
  const ext = path.toLowerCase().endsWith(".jpg") || path.toLowerCase().endsWith(".jpeg")
    ? "image/jpeg"
    : "image/png";
  return { dataUrl: `data:${ext};base64,${base64}`, sha: json.sha };
}

export const getAppAssetPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        type: z.enum(["icon", "splash"]),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const token = getGithubPAT();

    const lightPath =
      data.type === "icon" ? "assets/logo.png" : "assets/splash.png";
    const darkPath =
      data.type === "icon" ? "assets/logo-dark.png" : "assets/splash-dark.png";

    const [light, dark] = await Promise.all([
      fetchGithubFileAsDataUrl(
        app.github_owner,
        app.github_repo,
        app.default_ref,
        lightPath,
        token
      ),
      fetchGithubFileAsDataUrl(
        app.github_owner,
        app.github_repo,
        app.default_ref,
        darkPath,
        token
      ),
    ]);

    return {
      light: light?.dataUrl ?? null,
      dark: dark?.dataUrl ?? null,
      lightSha: light?.sha ?? null,
      darkSha: dark?.sha ?? null,
      ref: app.default_ref,
      repo: `${app.github_owner}/${app.github_repo}`,
    };
  });
