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

/**
 * Parse .env file content into key-value pairs
 */
function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = content.split("\n");
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;
    
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      // Remove surrounding quotes if present
      const unquoted = value.replace(/^["'](.*)["']$/, "$1");
      env[key] = unquoted;
    }
  }
  
  return env;
}

/**
 * Convert key-value pairs to .env file format
 */
function stringifyEnvFile(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => {
      // Quote value if it contains spaces or special characters
      const needsQuotes = /[\s#]/.test(value);
      const quoted = needsQuotes ? `"${value}"` : value;
      return `${key}=${quoted}`;
    })
    .join("\n") + "\n";
}

/**
 * Read .env.production from the app repo
 */
export const getEnvFile = createServerFn({ method: "POST" })
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
    
    const url = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents/.env.production?ref=${encodeURIComponent(ref)}`;
    
    const res = await fetch(url, { headers: githubHeaders() });
    
    // If file doesn't exist, return empty env
    if (res.status === 404) {
      return { env: {}, sha: null, exists: false };
    }
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
    }
    
    const json: any = await res.json();
    const content = Buffer.from(json.content, "base64").toString("utf-8");
    const env = parseEnvFile(content);
    
    return { env, sha: json.sha, exists: true };
  });

/**
 * Update or create .env.production in the app repo (commits and pushes)
 */
export const updateEnvFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        env: z.record(z.string()),
        ref: z.string().min(1).max(255).optional(),
        sha: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const ref = data.ref ?? app.default_ref ?? "main";
    
    const content = stringifyEnvFile(data.env);
    const contentBase64 = Buffer.from(content, "utf-8").toString("base64");
    
    const url = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents/.env.production`;
    
    const body: any = {
      message: "Update .env.production via bgp-admin",
      content: contentBase64,
      branch: ref,
    };
    
    // If file exists, include sha for update
    if (data.sha) {
      body.sha = data.sha;
    }
    
    const res = await fetch(url, {
      method: "PUT",
      headers: githubHeaders(),
      body: JSON.stringify(body),
    });
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
    }
    
    const json: any = await res.json();
    
    return { success: true, sha: json.content?.sha };
  });
