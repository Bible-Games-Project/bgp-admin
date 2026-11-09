import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { readSteamCoverage, storeSteamSales } from "./steam-sales.server";

async function assertAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

/** A lifetime file for a few games is well under a megabyte. */
const MAX_FILE_CHARS = 20_000_000;

/** Which days the Steam files uploaded so far cover; null before the first one. */
export const getSteamCoverage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    return readSteamCoverage(context.supabase);
  });

/** Adds the Steam sales file an admin downloaded from Steamworks to Revenue. */
export const uploadSteamSales = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        fileName: z.string().max(500),
        text: z
          .string()
          .min(1, "The file is empty.")
          .max(MAX_FILE_CHARS, "That file is too big to be Steam's sales file."),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return storeSteamSales({
      supabase: context.supabase,
      userId: context.userId,
      fileName: data.fileName,
      text: data.text,
    });
  });
