import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const appInputSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "lowercase, numbers and dashes only"),
  name: z.string().min(1).max(255),
  github_owner: z.string().min(1).max(255),
  github_repo: z.string().min(1).max(255),
  default_ref: z.string().min(1).max(255).default("main"),
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
