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
  const { data, error } = await supabase.from("apps").select("*").eq("id", appId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("App not found");
  return data;
}

// A version App Store Connect will still let us edit and attach a build to. Anything
// else is either already with Apple or already published.
const EDITABLE_STATES = [
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
];

// Apple holds one submission per app at a time, so a version sitting in any of these
// blocks the next release until it clears or is cancelled.
const IN_FLIGHT_STATES = [
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "PENDING_APPLE_RELEASE",
  "PENDING_DEVELOPER_RELEASE",
  "PROCESSING_FOR_APP_STORE",
];

const LIVE_STATES = ["READY_FOR_SALE"];

// Review submissions outlive the version state: attaching a build moves a REJECTED
// version back to PREPARE_FOR_SUBMISSION, so by the time anyone opens this dialog the
// rejection is invisible on the version itself. The submission still carries it. These
// are also exactly the states deploy-ios.yml refuses to submit alongside, so surfacing
// them here turns a failure twenty minutes into a build into a disabled button.
const OPEN_SUBMISSION_STATES = ["WAITING_FOR_REVIEW", "IN_REVIEW", "UNRESOLVED_ISSUES"];

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// WebCrypto rather than node:crypto: this runs in a Cloudflare Worker, and ECDSA
// P-256 signatures already come out in the IEEE P1363 form ES256 wants.
async function mintToken(keyId: string, issuerId: string, privateKeyPem: string) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const unsigned =
    base64url(encoder.encode(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }))) +
    "." +
    base64url(
      encoder.encode(
        JSON.stringify({ iss: issuerId, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }),
      ),
    );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(unsigned),
  );
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
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

type AscApi = {
  get: (path: string) => Promise<any>;
  patch: (path: string, body: unknown) => Promise<any>;
};

async function createAscApi(): Promise<AscApi | null> {
  const keyId = process.env.APP_STORE_CONNECT_API_KEY_ID;
  const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID;
  const keyBase64 = process.env.APP_STORE_CONNECT_API_KEY_BASE64;
  if (!keyId || !issuerId || !keyBase64) return null;

  const privateKey = new TextDecoder().decode(
    Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0)),
  );
  const token = await mintToken(keyId, issuerId, privateKey);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`App Store Connect returned ${res.status}: ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : {};
  };
  return {
    get: (path) => call("GET", path),
    patch: (path, body) => call("PATCH", path, body),
  };
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

async function findAscApp(api: AscApi, bundleId: string) {
  const res = await api.get(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
  return res.data?.[0] ?? null;
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

    const keyId = process.env.APP_STORE_CONNECT_API_KEY_ID;
    const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID;
    const keyBase64 = process.env.APP_STORE_CONNECT_API_KEY_BASE64;
    if (!keyId || !issuerId || !keyBase64) {
      return { available: false };
    }

    const bundleId = app.bundle_id as string | null;
    if (!bundleId) {
      return { available: true, error: "This app has no bundle ID set yet." };
    }

    try {
      const privateKey = new TextDecoder().decode(
        Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0)),
      );
      const token = await mintToken(keyId, issuerId, privateKey);
      const get = async (path: string) => {
        const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          throw new Error(`App Store Connect returned ${res.status}`);
        }
        return (await res.json()) as any;
      };

      const appsRes = await get(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
      const ascApp = appsRes.data?.[0];
      if (!ascApp) {
        return {
          available: true,
          error: `No app in App Store Connect matches ${bundleId}. Create it there first.`,
        };
      }

      const versionsRes = await get(
        `/v1/apps/${ascApp.id}/appStoreVersions?filter[platform]=IOS&limit=50`,
      );
      const versions: AscVersion[] = (versionsRes.data ?? []).map((v: any) => ({
        versionString: v.attributes.versionString,
        state: v.attributes.appVersionState ?? v.attributes.appStoreState,
      }));

      const submissionsRes = await get(
        `/v1/reviewSubmissions?filter[app]=${ascApp.id}&filter[platform]=IOS&limit=50`,
      );
      const openSubmission: AscSubmission | null =
        (submissionsRes.data ?? [])
          .map((sub: any) => ({ id: sub.id, state: sub.attributes.state }))
          .find((sub: AscSubmission) => OPEN_SUBMISSION_STATES.includes(sub.state)) ?? null;

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
