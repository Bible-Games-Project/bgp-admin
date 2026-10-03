import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readIncome, syncIncome } from "./income-sync.server";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

/**
 * The income the hourly job has stored, when it last ran (null: never), and what each
 * store is missing.
 */
export const getIncome = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    await assertAdmin(supabase, context.userId);
    const { rows, problems, checkedAt } = await readIncome(supabase);
    return { rows, problems, checkedAt };
  });

/** Runs the hourly job now. `remaining` > 0: it stopped at its limit, run it again. */
export const refreshIncome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    return syncIncome();
  });
