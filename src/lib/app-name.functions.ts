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
    "User-Agent": "bgp-admin",
  };
}

/**
 * Read the current app name from capacitor.config.ts
 */
export const getAppName = createServerFn({ method: "POST" })
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
    
    const url = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents/capacitor.config.ts?ref=${encodeURIComponent(ref)}`;
    
    const res = await fetch(url, { headers: githubHeaders() });
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
    }
    
    const json: any = await res.json();
    const content = Buffer.from(json.content, "base64").toString("utf-8");
    
    // Parse appName from capacitor.config.ts
    const appNameMatch = content.match(/appName:\s*['"]([^'"]+)['"]/);
    const appName = appNameMatch ? appNameMatch[1] : null;
    
    if (!appName) {
      throw new Error("Could not parse appName from capacitor.config.ts");
    }
    
    return { appName, sha: json.sha };
  });

/**
 * Update app name in all required files:
 * - capacitor.config.ts
 * - android/app/src/main/res/values/strings.xml
 * - ios/App/App/Info.plist
 */
export const updateAppName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        appName: z.string().min(1).max(100),
        ref: z.string().min(1).max(255).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const ref = data.ref ?? app.default_ref ?? "main";
    
    const owner = app.github_owner;
    const repo = app.github_repo;
    
    // Helper to fetch file content and SHA
    const fetchFile = async (path: string) => {
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
      const res = await fetch(url, { headers: githubHeaders() });
      
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to fetch ${path}: ${res.status} ${text.slice(0, 200)}`);
      }
      
      const json: any = await res.json();
      const content = Buffer.from(json.content, "base64").toString("utf-8");
      return { content, sha: json.sha };
    };
    
    // Helper to update file content
    const updateFile = async (path: string, content: string, sha: string, message: string) => {
      const contentBase64 = Buffer.from(content, "utf-8").toString("base64");
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
      
      const res = await fetch(url, {
        method: "PUT",
        headers: githubHeaders(),
        body: JSON.stringify({
          message,
          content: contentBase64,
          branch: ref,
          sha,
        }),
      });
      
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to update ${path}: ${res.status} ${text.slice(0, 200)}`);
      }
      
      return await res.json();
    };
    
    // 1. Update capacitor.config.ts
    const capacitorFile = await fetchFile("capacitor.config.ts");
    const updatedCapacitorContent = capacitorFile.content.replace(
      /appName:\s*['"][^'"]+['"]/,
      `appName: '${data.appName.replace(/'/g, "\\'")}'`
    );
    
    // 2. Update Android strings.xml
    const androidStringsFile = await fetchFile("android/app/src/main/res/values/strings.xml");
    const updatedAndroidContent = androidStringsFile.content
      .replace(
        /(<string name="app_name">)[^<]+(<\/string>)/,
        `$1${escapeXml(data.appName)}$2`
      )
      .replace(
        /(<string name="title_activity_main">)[^<]+(<\/string>)/,
        `$1${escapeXml(data.appName)}$2`
      );
    
    // 3. Update iOS Info.plist
    const iosInfoFile = await fetchFile("ios/App/App/Info.plist");
    const updatedIosContent = iosInfoFile.content.replace(
      /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]+(<\/string>)/,
      `$1${escapeXml(data.appName)}$2`
    );
    
    // Commit all changes
    await updateFile(
      "capacitor.config.ts",
      updatedCapacitorContent,
      capacitorFile.sha,
      `chore: update app name to "${data.appName}" via bgp-admin`
    );
    
    await updateFile(
      "android/app/src/main/res/values/strings.xml",
      updatedAndroidContent,
      androidStringsFile.sha,
      `chore: update app name to "${data.appName}" via bgp-admin`
    );
    
    await updateFile(
      "ios/App/App/Info.plist",
      updatedIosContent,
      iosInfoFile.sha,
      `chore: update app name to "${data.appName}" via bgp-admin`
    );
    
    return { success: true, appName: data.appName };
  });

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
