import { decodeBase64Text, pemToPkcs8, signJwt } from "./jwt.server";

type ServiceAccount = { client_email: string; private_key: string };

// The org secret holds the key file base64-encoded (deploy-android.yml pipes it through
// `base64 -d`); plain JSON is accepted too so a hand-set Worker secret also works.
function readServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const text = raw.trim().startsWith("{") ? raw : decodeBase64Text(raw);
  const parsed = JSON.parse(text);
  if (!parsed.client_email || !parsed.private_key) return null;
  return parsed;
}

async function fetchAccessToken(account: ServiceAccount): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    key,
    { name: "RSASSA-PKCS1-v1_5" },
  );
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Google refused the service account sign-in (${res.status}): ${json.error_description ?? json.error ?? "no reason given"}`,
    );
  }
  return json.access_token;
}

export class PlayError extends Error {
  /**
   * Where inside an edit it failed. A refusal while opening the edit means the service
   * account cannot see the app at all; one while changing it means it can see the app
   * but is not allowed to edit the listing.
   */
  stage?: "open" | "change";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type PlayApi = {
  /** The service account's address, for instructions that name who needs a permission. */
  serviceAccountEmail: string;
  /** `path` is relative to the app, e.g. `/edits/123/listings`. */
  call: (method: string, path: string, body?: unknown) => Promise<any>;
  /** Sends raw bytes to the media upload endpoint for the same `path`. */
  upload: (path: string, bytes: Uint8Array<ArrayBuffer>, contentType: string) => Promise<any>;
};

async function parsePlayResponse(res: Response) {
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 500);
    try {
      message = JSON.parse(text).error?.message ?? message;
    } catch {
      // Not JSON; keep the raw text.
    }
    throw new PlayError(message, res.status);
  }
  return text ? JSON.parse(text) : {};
}

/** Null when the Worker has no Google Play service account configured. */
export async function createPlayApi(packageName: string): Promise<PlayApi | null> {
  const account = readServiceAccount();
  if (!account) return null;
  const token = await fetchAccessToken(account);
  const app = `androidpublisher/v3/applications/${encodeURIComponent(packageName)}`;
  return {
    serviceAccountEmail: account.client_email,
    call: async (method, path, body) =>
      parsePlayResponse(
        await fetch(`https://androidpublisher.googleapis.com/${app}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
      ),
    upload: async (path, bytes, contentType) =>
      parsePlayResponse(
        await fetch(
          `https://androidpublisher.googleapis.com/upload/${app}${path}?uploadType=media`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
            body: bytes,
          },
        ),
      ),
  };
}

/**
 * Commits an edit, which sends its changes to Google's review. Returns whether Google
 * needs them sent for review by hand: it refuses to send them automatically when, for
 * example, earlier changes are still waiting in Publishing overview. The commit is
 * then retried with `changesNotSentForReview`.
 */
export async function commitEdit(api: PlayApi, editPath: string): Promise<boolean> {
  try {
    await api.call("POST", `${editPath}:commit`);
    return false;
  } catch (err) {
    if (err instanceof PlayError && /changesNotSentForReview/.test(err.message)) {
      await api.call("POST", `${editPath}:commit?changesNotSentForReview=true`);
      return true;
    }
    throw err;
  }
}

export async function openEdit(api: PlayApi): Promise<string> {
  try {
    const edit = await api.call("POST", "/edits", {});
    return `/edits/${edit.id}`;
  } catch (err) {
    if (err instanceof PlayError) err.stage = "open";
    throw err;
  }
}

/**
 * Runs `fn` inside a Play edit — Google's transaction for listing changes. With
 * `commit` the edit is committed (see commitEdit); otherwise, and on any failure, it is
 * deleted so no half-made edit is left behind.
 */
export async function withEdit<T>(
  api: PlayApi,
  fn: (editPath: string) => Promise<T>,
  { commit }: { commit: boolean },
): Promise<{ result: T; needsManualSend: boolean }> {
  const editPath = await openEdit(api);
  try {
    const result = await fn(editPath);
    if (!commit) {
      await api.call("DELETE", editPath).catch(() => {});
      return { result, needsManualSend: false };
    }
    return { result, needsManualSend: await commitEdit(api, editPath) };
  } catch (err) {
    if (err instanceof PlayError) err.stage = "change";
    await api.call("DELETE", editPath).catch(() => {});
    throw err;
  }
}
