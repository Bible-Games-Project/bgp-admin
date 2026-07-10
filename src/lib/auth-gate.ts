import { supabase } from "@/integrations/supabase/client";

export type GateResult =
  | { ok: true }
  | { redirect: "/login" | "/setup-mfa" | "/mfa-challenge" | "/forbidden" };

/**
 * How long the gate may spend on its Supabase calls before giving up.
 * In the Capacitor WebView a stale persisted session can make auth calls
 * hang forever (e.g. supabase-js navigator.locks / token refresh), which
 * would otherwise block beforeLoad and leave the app on a blank screen.
 */
const GATE_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Auth gate timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Central admin + MFA gate. Used by _authenticated.beforeLoad and by
 * post-login redirect logic.
 *
 * Never hangs or throws: any timeout or unexpected error falls back to
 * /login, which always renders and lets the user retry.
 */
export async function checkAccessGate(): Promise<GateResult> {
  try {
    return await withTimeout(runGate(), GATE_TIMEOUT_MS);
  } catch (error) {
    console.error("[auth-gate] Gate failed, redirecting to /login:", error);
    return { redirect: "/login" };
  }
}

async function runGate(): Promise<GateResult> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { redirect: "/login" };

  // 1. Must be in admins table.
  const { data: adminRow } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!adminRow) {
    await supabase.auth.signOut();
    return { redirect: "/forbidden" };
  }

  // 2. Must have a verified TOTP factor (mandatory MFA).
  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError) return { redirect: "/login" };
  const verifiedTotp = (factors?.totp ?? []).find((f) => f.status === "verified");
  if (!verifiedTotp) return { redirect: "/setup-mfa" };

  // 3. Must have stepped up to aal2 in this session.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") return { redirect: "/mfa-challenge" };

  return { ok: true };
}
