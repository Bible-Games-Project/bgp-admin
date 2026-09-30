// The Testers page: who can try each game before it's published, on TestFlight and on
// Google Play's testing tracks, and inviting more people on TestFlight.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { appStoreIds } from "./app-kind";
import { AscError } from "./asc.server";
import { PlayError, createPlayApi, withEdit } from "./google-play.server";
import {
  type TestFlight,
  inviteTester,
  readTestFlight,
  removeTester,
  sendBuildToTesters,
  setPublicLink,
} from "./testflight.server";

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
  if (!data) throw new Error("Game not found");
  return { name: String(data.name).trim(), ids: appStoreIds(data) };
}

export type { BetaGroup, TestBuild, TestFlight } from "./testflight.server";

const byApp = z.object({ appId: z.string().uuid() });

/** Apple's refusal in words someone can act on. */
function describeAscError(err: unknown): string {
  if (err instanceof AscError && (err.status === 401 || err.status === 403)) {
    return "App Store Connect didn't let the console do that: its API key needs the Admin or App Manager role.";
  }
  return (err as Error)?.message ?? "unknown error";
}

export const getTestFlight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => byApp.parse(input))
  .handler(async ({ data, context }): Promise<TestFlight> => {
    await assertAdmin(context.supabase, context.userId);
    const { ids } = await loadApp(context.supabase, data.appId);
    if (!ids.ios) return { found: false };
    try {
      return await readTestFlight(ids.ios);
    } catch (err) {
      return { found: false, problem: `Could not read TestFlight: ${describeAscError(err)}` };
    }
  });

export type PlayTrack = {
  track: string;
  releases: { name: string; status: string; versionCodes: string[] }[];
  googleGroups: string[];
};

export type PlayTesting =
  | { found: false; problem?: string }
  | { found: true; packageName: string; tracks: PlayTrack[] };

const TESTING_TRACKS = ["internal", "alpha", "beta"];

export const getPlayTesting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => byApp.parse(input))
  .handler(async ({ data, context }): Promise<PlayTesting> => {
    await assertAdmin(context.supabase, context.userId);
    const { ids } = await loadApp(context.supabase, data.appId);
    if (!ids.android) return { found: false };
    const api = await createPlayApi(ids.android);
    if (!api) return { found: false, problem: "Google Play is not connected to this console." };
    try {
      const { result } = await withEdit(
        api,
        async (edit) => {
          const all = await api.call("GET", `${edit}/tracks`);
          const tracks = (all.tracks ?? []).filter((t: any) => TESTING_TRACKS.includes(t.track));
          return Promise.all(
            tracks.map(async (t: any): Promise<PlayTrack> => {
              const testers = await api.call("GET", `${edit}/testers/${t.track}`).catch(() => ({}));
              return {
                track: t.track,
                releases: (t.releases ?? []).map((r: any) => ({
                  name: r.name ?? "",
                  status: r.status ?? "",
                  versionCodes: r.versionCodes ?? [],
                })),
                googleGroups: testers.googleGroups ?? [],
              };
            }),
          );
        },
        { commit: false },
      );
      return { found: true, packageName: ids.android, tracks: result };
    } catch (err) {
      if (err instanceof PlayError && err.status === 404) return { found: false };
      if (err instanceof PlayError && (err.status === 401 || err.status === 403)) {
        return {
          found: false,
          problem: `The console can't see ${ids.android} on Google Play. In Play Console → Users and permissions → ${api.serviceAccountEmail} → App permissions, add the game.`,
        };
      }
      return { found: false, problem: `Could not read Google Play: ${(err as Error).message}` };
    }
  });

export const inviteBetaTester = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        ascId: z.string().min(1).max(40),
        email: z.string().trim().email("That doesn't look like an email address"),
        firstName: z.string().trim().max(100).optional(),
        lastName: z.string().trim().max(100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    try {
      await inviteTester(data.ascId, data);
    } catch (err) {
      throw new Error(`Apple refused the invitation: ${describeAscError(err)}`);
    }
    return { ok: true };
  });

export const removeBetaTester = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ groupId: z.string().min(1).max(100), testerId: z.string().min(1).max(100) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    try {
      await removeTester(data.groupId, data.testerId);
    } catch (err) {
      throw new Error(`Apple refused: ${describeAscError(err)}`);
    }
    return { ok: true };
  });

export const setBetaPublicLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ ascId: z.string().min(1).max(40), enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    try {
      await setPublicLink(data.ascId, data.enabled);
    } catch (err) {
      throw new Error(`Apple refused: ${describeAscError(err)}`);
    }
    return { ok: true };
  });

export const sendBuildToBetaTesters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        ascId: z.string().min(1).max(40),
        buildId: z.string().min(1).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { name } = await loadApp(context.supabase, data.appId);
    try {
      return await sendBuildToTesters(data.ascId, data.buildId, name);
    } catch (err) {
      throw new Error(`Apple refused to send the build to testers: ${describeAscError(err)}`);
    }
  });
