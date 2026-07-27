import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { commitAgentDocs, inspectAgentDocs } from "@/lib/agent-docs.server";

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
  const { data, error } = await supabase.from("apps").select("*").eq("id", appId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("App not found");
  return data;
}

export const checkAgentDocs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ appId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const statuses = await inspectAgentDocs({
      owner: app.github_owner,
      repo: app.github_repo,
      branch: app.default_ref || "main",
    });
    return { statuses, allInSync: statuses.every((s) => s.inSync) };
  });

export const syncAgentDocs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ appId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const results = await commitAgentDocs({
      owner: app.github_owner,
      repo: app.github_repo,
      branch: app.default_ref || "main",
    });

    const changed = results.filter((r) => r.changed);
    return {
      success: true,
      results,
      message: changed.length
        ? `Synced ${changed.length} file${changed.length === 1 ? "" : "s"}: ${changed.map((r) => r.file).join(", ")}.`
        : "Already up to date — nothing to commit.",
    };
  });
