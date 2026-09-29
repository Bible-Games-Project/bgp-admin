import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  EDITABLE_STATES,
  IN_FLIGHT_STATES,
  LIVE_STATES,
  OPEN_SUBMISSION_STATES,
  createAscApi,
  findAscApp,
  versionStateOf,
  type AscApi,
} from "./asc.server";

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

type AscVersion = { versionString: string; state: string };
type AscSubmission = { id: string; state: string };

export type AppStoreVersionState = {
  /** False when the Worker has no App Store Connect credentials configured. */
  available: boolean;
  /** Set when we could not read the store; the UI falls back to manual entry. */
  error?: string;
  appName?: string;
  /** App Store Connect's own id for the app, for deep links into its pages. */
  ascAppId?: string;
  editable?: AscVersion | null;
  inFlight?: AscVersion | null;
  live?: AscVersion | null;
  /** An unfinished review submission, which blocks sending another one. */
  openSubmission?: AscSubmission | null;
  /** Major.Minor the dialog should prefill, and why. */
  suggested?: { major: string; minor: string; reason: string };
};

function splitVersion(v: string): { major: string; minor: string } {
  const parts = v.split(".");
  return { major: parts[0] ?? "0", minor: parts[1] ?? "0" };
}

async function findOpenSubmission(api: AscApi, ascAppId: string): Promise<AscSubmission | null> {
  const res = await api.get(
    `/v1/reviewSubmissions?filter[app]=${ascAppId}&filter[platform]=IOS&limit=50`,
  );
  return (
    (res.data ?? [])
      .map((sub: any) => ({ id: sub.id, state: sub.attributes.state }))
      .find((sub: AscSubmission) => OPEN_SUBMISSION_STATES.includes(sub.state)) ?? null
  );
}

/**
 * Frees the one submission slot Apple allows, so a fixed build can be sent again.
 * The submission id is looked up server-side from the app rather than taken from the
 * caller, so this can only ever cancel a submission belonging to this app.
 */
export const cancelOpenReviewSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const bundleId = app.bundle_id as string | null;
    if (!bundleId) throw new Error("This app has no bundle ID set.");

    const api = await createAscApi();
    if (!api) throw new Error("App Store Connect credentials are not configured.");

    const ascApp = await findAscApp(api, bundleId);
    if (!ascApp) throw new Error(`No app in App Store Connect matches ${bundleId}.`);

    const open = await findOpenSubmission(api, ascApp.id);
    if (!open) return { cancelled: false, message: "There is no open submission to cancel." };

    await api.patch(`/v1/reviewSubmissions/${open.id}`, {
      data: { type: "reviewSubmissions", id: open.id, attributes: { canceled: true } },
    });
    return {
      cancelled: true,
      message: `Submission cancelled. The slot is free — a new release can be sent.`,
    };
  });

export const getAppStoreVersionState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<AppStoreVersionState> => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);

    const api = await createAscApi();
    if (!api) {
      return { available: false };
    }

    const bundleId = app.bundle_id as string | null;
    if (!bundleId) {
      return { available: true, error: "This app has no bundle ID set yet." };
    }

    try {
      const ascApp = await findAscApp(api, bundleId);
      if (!ascApp) {
        return {
          available: true,
          error: `No app in App Store Connect matches ${bundleId}. Create it there first.`,
        };
      }

      const versionsRes = await api.get(
        `/v1/apps/${ascApp.id}/appStoreVersions?filter[platform]=IOS&limit=50`,
      );
      const versions: AscVersion[] = (versionsRes.data ?? []).map((v: any) => ({
        versionString: v.attributes.versionString,
        state: versionStateOf(v),
      }));

      const openSubmission = await findOpenSubmission(api, ascApp.id);

      const editable = versions.find((v) => EDITABLE_STATES.includes(v.state)) ?? null;
      const inFlight = versions.find((v) => IN_FLIGHT_STATES.includes(v.state)) ?? null;
      const live = versions.find((v) => LIVE_STATES.includes(v.state)) ?? null;

      // The third segment is the GitHub run number, which only ever goes up, so
      // reusing the published Major.Minor still produces a higher version than the
      // one on sale. Only a brand new app needs a number invented for it.
      let suggested: { major: string; minor: string; reason: string };
      if (editable) {
        suggested = {
          ...splitVersion(editable.versionString),
          reason: `App Store Connect already has version ${editable.versionString} open and waiting for a build.`,
        };
      } else if (live) {
        suggested = {
          ...splitVersion(live.versionString),
          reason: `Version ${live.versionString} is on sale. Keeping the same Major.Minor is fine — the build number rises on its own.`,
        };
      } else {
        suggested = {
          major: "1",
          minor: "0",
          reason: "This app has no version in App Store Connect yet, so a first release is 1.0.",
        };
      }

      return {
        available: true,
        appName: ascApp.attributes?.name,
        ascAppId: ascApp.id,
        editable,
        inFlight,
        live,
        openSubmission,
        suggested,
      };
    } catch (err: any) {
      return { available: true, error: err?.message ?? "Could not reach App Store Connect." };
    }
  });
