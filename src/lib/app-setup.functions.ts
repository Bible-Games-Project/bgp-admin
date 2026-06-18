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

export const listSetupSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ appId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("app_setup_steps")
      .select("step_key, completed_at")
      .eq("app_id", data.appId);
    if (error) throw new Error(error.message);
    return { steps: rows ?? [] };
  });

export const setSetupStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        appId: z.string().uuid(),
        stepKey: z.string().min(1).max(64),
        completed: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.completed) {
      const { error } = await context.supabase.from("app_setup_steps").upsert({
        app_id: data.appId,
        step_key: data.stepKey,
        completed_by: context.userId,
        completed_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase
        .from("app_setup_steps")
        .delete()
        .eq("app_id", data.appId)
        .eq("step_key", data.stepKey);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
