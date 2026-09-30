import { decodeBase64Text, pemToPkcs8, signJwt } from "./jwt.server";

export {
  EDITABLE_STATES,
  IN_FLIGHT_STATES,
  LIVE_STATES,
  OPEN_SUBMISSION_STATES,
  versionStateOf,
} from "./asc-states";

// ES256 via WebCrypto: ECDSA P-256 signatures already come out in the IEEE P1363 form
// the JWT wants.
export async function mintToken(keyId: string, issuerId: string, privateKeyPem: string) {
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
  /** `body`: relationship removals, which name what to remove in the body. */
  delete: (path: string, body?: unknown) => Promise<any>;
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
    delete: (path, body) => call("DELETE", path, body),
  };
}

// Apple's filter matches part of a bundle ID too: com.biblegamesproject.didacticjesusgame
// (the demo, not on the App Store) returns com.biblegamesproject.didacticjesusgame.pro.
// Only an exact match is the app.
export async function findAscApp(api: AscApi, bundleId: string) {
  const res = await api.get(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
  return res.data?.find((app: any) => app.attributes?.bundleId === bundleId) ?? null;
}
