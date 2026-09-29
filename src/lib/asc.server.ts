import { decodeBase64Text, pemToPkcs8, signJwt } from "./jwt.server";

// A version App Store Connect will still let us edit and attach a build to. Anything
// else is either already with Apple or already published.
export const EDITABLE_STATES = [
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
];

// Apple holds one submission per app at a time, so a version sitting in any of these
// blocks the next release until it clears or is cancelled.
export const IN_FLIGHT_STATES = [
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "PENDING_APPLE_RELEASE",
  "PENDING_DEVELOPER_RELEASE",
  "PROCESSING_FOR_APP_STORE",
  "PROCESSING_FOR_DISTRIBUTION",
  "ACCEPTED",
];

// READY_FOR_SALE is the old `appStoreState` name, READY_FOR_DISTRIBUTION the
// `appVersionState` one that replaces it.
export const LIVE_STATES = ["READY_FOR_SALE", "READY_FOR_DISTRIBUTION"];

// Review submissions outlive the version state: attaching a build moves a REJECTED
// version back to PREPARE_FOR_SUBMISSION, so by the time anyone opens this dialog the
// rejection is invisible on the version itself. The submission still carries it. These
// are also exactly the states deploy-ios.yml refuses to submit alongside, so surfacing
// them here turns a failure twenty minutes into a build into a disabled button.
export const OPEN_SUBMISSION_STATES = ["WAITING_FOR_REVIEW", "IN_REVIEW", "UNRESOLVED_ISSUES"];

/** Apple is migrating `appStoreState` to `appVersionState`; read whichever is there. */
export function versionStateOf(v: any): string {
  return v.attributes?.appVersionState ?? v.attributes?.appStoreState ?? "UNKNOWN";
}

// ES256 via WebCrypto: ECDSA P-256 signatures already come out in the IEEE P1363 form
// the JWT wants.
async function mintToken(keyId: string, issuerId: string, privateKeyPem: string) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    { alg: "ES256", kid: keyId, typ: "JWT" },
    { iss: issuerId, iat: now, exp: now + 600, aud: "appstoreconnect-v1" },
    key,
    { name: "ECDSA", hash: "SHA-256" },
  );
}

// Apple puts the actual reason for a refusal (e.g. which language is missing a required
// field) in meta.associatedErrors, deep in the body — a length cut loses it. Spell every
// error out instead. Same logic as describeAppleError in deploy-ios.yml.
export function describeAppleError(text: string): string {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
  const lines: string[] = [];
  for (const e of json.errors ?? []) {
    lines.push([e.title, e.detail].filter(Boolean).join(" — "));
    const associated = e.meta?.associatedErrors ?? {};
    for (const errs of Object.values(associated) as any[][]) {
      for (const a of errs ?? []) {
        lines.push(`• ${[a.title, a.detail].filter(Boolean).join(" — ")}`);
      }
    }
  }
  return lines.length ? lines.join("\n") : text.slice(0, 500);
}

export class AscError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type AscApi = {
  get: (path: string) => Promise<any>;
  post: (path: string, body: unknown) => Promise<any>;
  patch: (path: string, body: unknown) => Promise<any>;
  delete: (path: string) => Promise<any>;
};

/** Null when the Worker has no App Store Connect credentials configured. */
export async function createAscApi(): Promise<AscApi | null> {
  const keyId = process.env.APP_STORE_CONNECT_API_KEY_ID;
  const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID;
  const keyBase64 = process.env.APP_STORE_CONNECT_API_KEY_BASE64;
  if (!keyId || !issuerId || !keyBase64) return null;

  const token = await mintToken(keyId, issuerId, decodeBase64Text(keyBase64));
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
      throw new AscError(
        `App Store Connect returned ${res.status}: ${describeAppleError(text)}`,
        res.status,
      );
    }
    return text ? JSON.parse(text) : {};
  };
  return {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body),
    patch: (path, body) => call("PATCH", path, body),
    delete: (path) => call("DELETE", path),
  };
}

export async function findAscApp(api: AscApi, bundleId: string) {
  const res = await api.get(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
  return res.data?.[0] ?? null;
}
